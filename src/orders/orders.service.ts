import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { generateUuidV7 } from '../common/utils/uuidv7.util';
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
  private readonly maxIdGenerationAttempts = 3;

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

    let lastError: unknown;

    // UUIDv7 충돌 가능성에 대비해 제한 횟수만큼 재시도한다.
    for (let attempt = 1; attempt <= this.maxIdGenerationAttempts; attempt += 1) {
      const orderId = generateUuidV7();

      try {
        await this.dataSource.transaction(async (manager) => {
          // 주문/결제/재고/배송/Outbox를 하나의 트랜잭션으로 묶어 데이터 정합성을 보장한다.
          const order = manager.create(Order, {
            id: orderId,
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

          // Outbox 이벤트도 동일 트랜잭션에서 생성해 이벤트 유실을 방지한다.
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
        });

        return this.findById(orderId);
      } catch (error) {
        // 멱등키 충돌은 동시성 경쟁 상황으로 간주하고 기존 주문 반환을 시도한다.
        if (this.isIdempotencyViolation(error) && idempotencyKey) {
          const existing = await this.orderRepository.findOne({
            where: { idempotencyKey },
          });
          if (existing) {
            return existing;
          }
        }

        if (this.isOrderIdViolation(error)) {
          lastError = error;
          continue;
        }

        throw error;
      }
    }

    throw new Error(`Failed to generate unique order id: ${String(lastError)}`);
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

    await this.persistStatusChange(id, dto.status, false);
    return this.findById(id);
  }

  async forceStatus(
    id: string,
    status: OrderStatus,
    actor = 'system',
    reason?: string,
  ): Promise<Order> {
    // 운영자 강제 변경은 상태머신을 우회한다.
    await this.persistStatusChange(id, status, true, actor, reason);
    return this.findById(id);
  }

  private async persistStatusChange(
    id: string,
    nextStatus: OrderStatus,
    forced: boolean,
    actor = 'system',
    reason?: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const targetOrder = await manager.findOne(Order, { where: { id } });
      if (!targetOrder) {
        throw new NotFoundException(`Order not found: ${id}`);
      }

      const previousStatus = targetOrder.status;
      targetOrder.status = nextStatus;
      await manager.save(targetOrder);

      await this.applyStatusSideEffects(manager, id, nextStatus);

      const outboxEvent = manager.create(OutboxEvent, {
        aggregateType: 'Order',
        aggregateId: id,
        eventType: OrderEventType.STATUS_CHANGED,
        payload: {
          orderId: id,
          previousStatus,
          nextStatus,
          forced,
          actor,
          reason: reason ?? null,
        },
      });
      await manager.save(outboxEvent);
    });
  }

  private async applyStatusSideEffects(
    manager: EntityManager,
    orderId: string,
    status: OrderStatus,
  ): Promise<void> {
    if (status === OrderStatus.PAID) {
      const payment = await manager.findOne(Payment, { where: { orderId } });
      if (payment) {
        payment.status = PaymentStatus.AUTHORIZED;
        payment.processedAt = new Date();
        await manager.save(payment);
      }
    }

    if (status === OrderStatus.FAILED) {
      const payment = await manager.findOne(Payment, { where: { orderId } });
      if (payment) {
        payment.status = PaymentStatus.CANCELLED;
        payment.processedAt = new Date();
        await manager.save(payment);
      }
    }

    if (status === OrderStatus.SHIPPED) {
      const shipment = await manager.findOne(Shipment, { where: { orderId } });
      if (shipment) {
        shipment.status = ShipmentStatus.SHIPPED;
        shipment.shippedAt = shipment.shippedAt ?? new Date();
        await manager.save(shipment);
      }
    }
  }

  private isOrderIdViolation(error: unknown): boolean {
    const message = this.getErrorMessage(error);
    return message.includes('UNIQUE constraint failed: orders.id');
  }

  private isIdempotencyViolation(error: unknown): boolean {
    const message = this.getErrorMessage(error);
    return message.includes('UNIQUE constraint failed: orders.idempotencyKey');
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
