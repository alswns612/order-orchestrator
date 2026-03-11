import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLogService } from './audit-log.service';
import {
  InventoryReservation,
  InventoryReservationStatus,
} from './entities/inventory-reservation.entity';
import { Order } from './entities/order.entity';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { Shipment, ShipmentStatus } from './entities/shipment.entity';
import { FailureInjectionService } from './failure-injection.service';
import { OrderStatus } from './order-status.enum';
import { OrdersService } from './orders.service';

interface CompensationContext {
  paymentAuthorized: boolean;
  inventoryConfirmed: boolean;
}

@Injectable()
export class SagaOrchestratorService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(InventoryReservation)
    private readonly inventoryRepository: Repository<InventoryReservation>,
    @InjectRepository(Shipment)
    private readonly shipmentRepository: Repository<Shipment>,
    private readonly ordersService: OrdersService,
    private readonly auditLogService: AuditLogService,
    private readonly failureInjectionService: FailureInjectionService,
    private readonly dataSource: DataSource,
  ) {}

  async handleOrderCreated(orderId: string): Promise<void> {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException(`Order not found: ${orderId}`);
    }

    // 이미 처리 중/완료/실패 상태면 중복 오케스트레이션을 생략한다.
    if (order.status !== OrderStatus.PENDING) {
      return;
    }

    await this.executeSaga(orderId, 'saga');
  }

  async reprocessFailedOrder(orderId: string, actor = 'admin'): Promise<Order> {
    const order = await this.orderRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException(`Order not found: ${orderId}`);
    }

    if (order.status !== OrderStatus.FAILED) {
      throw new ConflictException(
        `Only FAILED orders can be reprocessed. current=${order.status}`,
      );
    }

    await this.auditLogService.log(
      orderId,
      'REPROCESS_REQUESTED',
      actor,
      { previousStatus: order.status },
    );

    // 실패 상태를 재처리 가능한 초기 상태로 되돌린다.
    await this.dataSource.transaction(async (manager) => {
      const targetOrder = await manager.findOne(Order, { where: { id: orderId } });
      const payment = await manager.findOne(Payment, { where: { orderId } });
      const inventory = await manager.findOne(InventoryReservation, {
        where: { orderId },
      });
      const shipment = await manager.findOne(Shipment, { where: { orderId } });

      if (!targetOrder || !payment || !inventory || !shipment) {
        throw new NotFoundException(`Order aggregate not complete: ${orderId}`);
      }

      targetOrder.status = OrderStatus.PENDING;
      payment.status = PaymentStatus.PENDING;
      payment.processedAt = null;
      inventory.status = InventoryReservationStatus.RESERVED;
      shipment.status = ShipmentStatus.REQUESTED;
      shipment.carrier = null;
      shipment.trackingNumber = null;
      shipment.shippedAt = null;

      await manager.save(targetOrder);
      await manager.save(payment);
      await manager.save(inventory);
      await manager.save(shipment);
    });

    await this.auditLogService.log(
      orderId,
      'REPROCESS_RESET_COMPLETED',
      actor,
      {},
    );

    await this.executeSaga(orderId, actor);
    return this.ordersService.findById(orderId);
  }

  private async executeSaga(orderId: string, actor: string): Promise<void> {
    const context: CompensationContext = {
      paymentAuthorized: false,
      inventoryConfirmed: false,
    };

    await this.auditLogService.log(orderId, 'SAGA_STARTED', actor);

    try {
      await this.authorizePayment(orderId, actor);
      context.paymentAuthorized = true;

      await this.ordersService.updateStatus(orderId, { status: OrderStatus.PAID });
      await this.auditLogService.log(orderId, 'ORDER_MARKED_PAID', actor);

      await this.confirmInventory(orderId, actor);
      context.inventoryConfirmed = true;

      await this.requestShipment(orderId, actor);
      await this.ordersService.updateStatus(orderId, { status: OrderStatus.SHIPPED });

      await this.auditLogService.log(orderId, 'SAGA_COMPLETED', actor);
    } catch (error) {
      await this.compensate(orderId, actor, context, error);
      throw error;
    }
  }

  private async authorizePayment(orderId: string, actor: string): Promise<void> {
    this.failureInjectionService.throwIfConfigured(
      'SAGA:PAYMENT_AUTHORIZE',
      'Injected failure at payment authorize step',
    );

    const payment = await this.paymentRepository.findOne({ where: { orderId } });
    if (!payment) {
      throw new NotFoundException(`Payment not found for order: ${orderId}`);
    }

    payment.status = PaymentStatus.AUTHORIZED;
    payment.processedAt = new Date();
    await this.paymentRepository.save(payment);

    await this.auditLogService.log(orderId, 'PAYMENT_AUTHORIZED', actor);
  }

  private async confirmInventory(orderId: string, actor: string): Promise<void> {
    this.failureInjectionService.throwIfConfigured(
      'SAGA:INVENTORY_CONFIRM',
      'Injected failure at inventory confirm step',
    );

    const inventory = await this.inventoryRepository.findOne({ where: { orderId } });
    if (!inventory) {
      throw new NotFoundException(`Inventory reservation not found for order: ${orderId}`);
    }

    inventory.status = InventoryReservationStatus.CONFIRMED;
    await this.inventoryRepository.save(inventory);

    await this.auditLogService.log(orderId, 'INVENTORY_CONFIRMED', actor);
  }

  private async requestShipment(orderId: string, actor: string): Promise<void> {
    this.failureInjectionService.throwIfConfigured(
      'SAGA:SHIPMENT_REQUEST',
      'Injected failure at shipment request step',
    );

    const shipment = await this.shipmentRepository.findOne({ where: { orderId } });
    if (!shipment) {
      throw new NotFoundException(`Shipment not found for order: ${orderId}`);
    }

    shipment.status = ShipmentStatus.SHIPPED;
    shipment.shippedAt = new Date();
    shipment.carrier = shipment.carrier ?? 'TOY-DELIVERY';
    shipment.trackingNumber =
      shipment.trackingNumber ?? `TRK-${orderId.slice(0, 8).toUpperCase()}`;

    await this.shipmentRepository.save(shipment);
    await this.auditLogService.log(orderId, 'SHIPMENT_REQUESTED', actor);
  }

  private async compensate(
    orderId: string,
    actor: string,
    context: CompensationContext,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);

    // 후행 단계 실패 시 선행 단계의 사이드 이펙트를 역순으로 보상한다.
    if (context.inventoryConfirmed) {
      const inventory = await this.inventoryRepository.findOne({ where: { orderId } });
      if (inventory) {
        inventory.status = InventoryReservationStatus.RELEASED;
        await this.inventoryRepository.save(inventory);
        await this.auditLogService.log(orderId, 'COMPENSATION_INVENTORY_RELEASED', actor);
      }
    }

    if (context.paymentAuthorized) {
      const payment = await this.paymentRepository.findOne({ where: { orderId } });
      if (payment) {
        payment.status = PaymentStatus.CANCELLED;
        payment.processedAt = new Date();
        await this.paymentRepository.save(payment);
        await this.auditLogService.log(orderId, 'COMPENSATION_PAYMENT_CANCELLED', actor);
      }
    }

    await this.ordersService.forceStatus(
      orderId,
      OrderStatus.FAILED,
      actor,
      `Saga failed: ${message}`,
    );

    await this.auditLogService.log(
      orderId,
      'SAGA_FAILED',
      actor,
      { error: message },
      message,
    );
  }
}
