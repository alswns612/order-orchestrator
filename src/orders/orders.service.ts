import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrderStatus } from './order-status.enum';
import { OrderEventType } from './order-events.constants';
import {
  InventoryReservation,
  InventoryReservationStatus,
} from './entities/inventory-reservation.entity';
import { OutboxEvent } from './entities/outbox-event.entity';
import { Order } from './entities/order.entity';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { Shipment, ShipmentStatus } from './entities/shipment.entity';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly stateMachine: OrderStateMachineService,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateOrderDto, idempotencyKey?: string): Promise<Order> {
    // 동일 멱등키 요청이 이미 처리된 경우, 기존 주문을 그대로 반환한다.
    if (idempotencyKey) {
      const existing = await this.orderRepository.findOne({
        where: { idempotencyKey },
      });
      if (existing) {
        return existing;
      }
    }

    const totalAmount = dto.items.reduce((sum, item) => {
      return sum + item.qty * item.price;
    }, 0);

    const orderId = await this.dataSource.transaction(async (manager) => {
      // 주문/결제/재고/배송/Outbox를 하나의 트랜잭션으로 묶어 데이터 정합성을 보장한다.
      const order = manager.create(Order, {
        customerId: dto.customerId,
        items: dto.items,
        totalAmount,
        status: OrderStatus.PENDING,
        idempotencyKey: idempotencyKey ?? null,
      });
      const savedOrder = await manager.save(order);

      const payment = manager.create(Payment, {
        orderId: savedOrder.id,
        amount: totalAmount,
        status: PaymentStatus.PENDING,
      });
      await manager.save(payment);

      const inventoryReservation = manager.create(InventoryReservation, {
        orderId: savedOrder.id,
        status: InventoryReservationStatus.RESERVED,
        reservations: dto.items.map((item) => ({
          sku: item.sku,
          qty: item.qty,
        })),
      });
      await manager.save(inventoryReservation);

      const shipment = manager.create(Shipment, {
        orderId: savedOrder.id,
        status: ShipmentStatus.REQUESTED,
      });
      await manager.save(shipment);

      // Outbox 이벤트도 동일 트랜잭션에서 생성해 "주문 저장됐는데 이벤트 유실" 문제를 방지한다.
      const outboxEvent = manager.create(OutboxEvent, {
        aggregateType: 'Order',
        aggregateId: savedOrder.id,
        eventType: OrderEventType.CREATED,
        payload: {
          orderId: savedOrder.id,
          customerId: savedOrder.customerId,
          totalAmount,
          status: savedOrder.status,
        },
      });
      await manager.save(outboxEvent);

      return savedOrder.id;
    });

    return this.findById(orderId);
  }

  async findById(id: string): Promise<Order> {
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order not found: ${id}`);
    }
    return order;
  }

  async updateStatus(id: string, dto: UpdateOrderStatusDto): Promise<Order> {
    const order = await this.findById(id);
    // 상태 전이 규칙을 먼저 검증한다.
    this.stateMachine.assertTransition(order.status, dto.status);

    await this.dataSource.transaction(async (manager) => {
      const targetOrder = await manager.findOne(Order, { where: { id } });
      if (!targetOrder) {
        throw new NotFoundException(`Order not found: ${id}`);
      }

      const previousStatus = targetOrder.status;
      targetOrder.status = dto.status;
      await manager.save(targetOrder);

      // 상태 변화에 맞춰 하위 도메인(결제/배송)을 함께 반영한다.
      if (dto.status === OrderStatus.PAID) {
        const payment = await manager.findOne(Payment, { where: { orderId: id } });
        if (payment) {
          payment.status = PaymentStatus.AUTHORIZED;
          payment.processedAt = new Date();
          await manager.save(payment);
        }
      }

      if (dto.status === OrderStatus.FAILED) {
        const payment = await manager.findOne(Payment, { where: { orderId: id } });
        if (payment) {
          payment.status = PaymentStatus.CANCELLED;
          payment.processedAt = new Date();
          await manager.save(payment);
        }
      }

      if (dto.status === OrderStatus.SHIPPED) {
        const shipment = await manager.findOne(Shipment, { where: { orderId: id } });
        if (shipment) {
          shipment.status = ShipmentStatus.SHIPPED;
          shipment.shippedAt = new Date();
          await manager.save(shipment);
        }
      }

      // 상태 변경 이벤트를 Outbox에 적재해 비동기 후처리 대상으로 넘긴다.
      const outboxEvent = manager.create(OutboxEvent, {
        aggregateType: 'Order',
        aggregateId: id,
        eventType: OrderEventType.STATUS_CHANGED,
        payload: {
          orderId: id,
          previousStatus,
          nextStatus: dto.status,
        },
      });
      await manager.save(outboxEvent);
    });

    return this.findById(id);
  }
}
