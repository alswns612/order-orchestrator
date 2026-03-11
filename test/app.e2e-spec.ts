import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuditLog } from '../src/orders/entities/audit-log.entity';
import { DeadLetterEvent } from '../src/orders/entities/dead-letter-event.entity';
import {
  InventoryReservation,
  InventoryReservationStatus,
} from '../src/orders/entities/inventory-reservation.entity';
import { Order } from '../src/orders/entities/order.entity';
import {
  OutboxEvent,
  OutboxEventStatus,
} from '../src/orders/entities/outbox-event.entity';
import { Payment, PaymentStatus } from '../src/orders/entities/payment.entity';
import { Shipment, ShipmentStatus } from '../src/orders/entities/shipment.entity';
import { FailureInjectionService } from '../src/orders/failure-injection.service';
import { OrderEventType } from '../src/orders/order-events.constants';
import { OrderStatus } from '../src/orders/order-status.enum';
import { OrdersService } from '../src/orders/orders.service';
import { OutboxProcessorService } from '../src/orders/outbox-processor.service';
import { SagaOrchestratorService } from '../src/orders/saga-orchestrator.service';

describe('Orders Flow (e2e-like integration)', () => {
  let app: INestApplication;
  let ordersService: OrdersService;
  let outboxProcessor: OutboxProcessorService;
  let sagaOrchestrator: SagaOrchestratorService;
  let failureInjectionService: FailureInjectionService;
  let dataSource: DataSource;

  let outboxRepository: Repository<OutboxEvent>;
  let deadLetterRepository: Repository<DeadLetterEvent>;
  let orderRepository: Repository<Order>;
  let paymentRepository: Repository<Payment>;
  let inventoryRepository: Repository<InventoryReservation>;
  let shipmentRepository: Repository<Shipment>;
  let auditLogRepository: Repository<AuditLog>;

  beforeAll(async () => {
    process.env.DATABASE_PATH = ':memory:';
    process.env.OUTBOX_PROCESSOR_ENABLED = 'false';
    process.env.OUTBOX_RETRY_BASE_MS = '0';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    ordersService = app.get(OrdersService);
    outboxProcessor = app.get(OutboxProcessorService);
    sagaOrchestrator = app.get(SagaOrchestratorService);
    failureInjectionService = app.get(FailureInjectionService);
    dataSource = app.get(DataSource);

    outboxRepository = app.get<Repository<OutboxEvent>>(getRepositoryToken(OutboxEvent));
    deadLetterRepository = app.get<Repository<DeadLetterEvent>>(
      getRepositoryToken(DeadLetterEvent),
    );
    orderRepository = app.get<Repository<Order>>(getRepositoryToken(Order));
    paymentRepository = app.get<Repository<Payment>>(getRepositoryToken(Payment));
    inventoryRepository = app.get<Repository<InventoryReservation>>(
      getRepositoryToken(InventoryReservation),
    );
    shipmentRepository = app.get<Repository<Shipment>>(getRepositoryToken(Shipment));
    auditLogRepository = app.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));
  });

  beforeEach(async () => {
    failureInjectionService.clear();
    await dataSource.synchronize(true);
  });

  afterAll(async () => {
    await app.close();
  });

  async function dispatchSeveral(times = 3): Promise<void> {
    for (let i = 0; i < times; i += 1) {
      await outboxProcessor.dispatchPending(100, true);
    }
  }

  it('creates order with UUIDv7 id and loads it', async () => {
    const created = await ordersService.create(
      {
        customerId: 'customer-1',
        items: [
          { sku: 'SKU-1', qty: 2, price: 1000 },
          { sku: 'SKU-2', qty: 1, price: 500 },
        ],
      },
      'order-001',
    );

    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(created.status).toBe(OrderStatus.PENDING);
    expect(created.totalAmount).toBe(2500);

    const loaded = await ordersService.findById(created.id);
    expect(loaded.id).toBe(created.id);
    expect(loaded.customerId).toBe('customer-1');
  });

  it('rejects invalid transition PENDING -> SHIPPED', async () => {
    const created = await ordersService.create({
      customerId: 'customer-2',
      items: [{ sku: 'SKU-3', qty: 1, price: 3000 }],
    });

    await expect(
      ordersService.updateStatus(created.id, { status: OrderStatus.SHIPPED }),
    ).rejects.toThrow('Invalid order state transition');
  });

  it('is idempotent with same key', async () => {
    const payload = {
      customerId: 'customer-3',
      items: [{ sku: 'SKU-4', qty: 1, price: 1500 }],
    };

    const first = await ordersService.create(payload, 'idem-001');
    const second = await ordersService.create(payload, 'idem-001');

    expect(first.id).toBe(second.id);
  });

  it('runs saga and completes order to SHIPPED when ORDER_CREATED is dispatched', async () => {
    const created = await ordersService.create(
      {
        customerId: 'customer-4',
        items: [{ sku: 'SKU-5', qty: 1, price: 2200 }],
      },
      'order-saga-success',
    );

    await dispatchSeveral();

    const order = await orderRepository.findOneOrFail({ where: { id: created.id } });
    const payment = await paymentRepository.findOneOrFail({
      where: { orderId: created.id },
    });
    const inventory = await inventoryRepository.findOneOrFail({
      where: { orderId: created.id },
    });
    const shipment = await shipmentRepository.findOneOrFail({
      where: { orderId: created.id },
    });

    expect(order.status).toBe(OrderStatus.SHIPPED);
    expect(payment.status).toBe(PaymentStatus.AUTHORIZED);
    expect(inventory.status).toBe(InventoryReservationStatus.CONFIRMED);
    expect(shipment.status).toBe(ShipmentStatus.SHIPPED);

    const logs = await auditLogRepository.find({ where: { orderId: created.id } });
    expect(logs.some((log) => log.action === 'SAGA_COMPLETED')).toBeTruthy();
  });

  it('compensates on shipment-step failure and supports admin reprocess', async () => {
    const created = await ordersService.create(
      {
        customerId: 'customer-5',
        items: [{ sku: 'SKU-6', qty: 1, price: 5000 }],
      },
      'order-saga-fail',
    );

    failureInjectionService.setRule('SAGA:SHIPMENT_REQUEST', 1);
    await outboxProcessor.dispatchPending(100, true);

    const failedOrder = await orderRepository.findOneOrFail({
      where: { id: created.id },
    });
    const paymentAfterFailure = await paymentRepository.findOneOrFail({
      where: { orderId: created.id },
    });
    const inventoryAfterFailure = await inventoryRepository.findOneOrFail({
      where: { orderId: created.id },
    });

    expect(failedOrder.status).toBe(OrderStatus.FAILED);
    expect(paymentAfterFailure.status).toBe(PaymentStatus.CANCELLED);
    expect(inventoryAfterFailure.status).toBe(InventoryReservationStatus.RELEASED);

    const reprocessed = await sagaOrchestrator.reprocessFailedOrder(
      created.id,
      'admin-test',
    );

    expect(reprocessed.status).toBe(OrderStatus.SHIPPED);

    const logs = await auditLogRepository.find({ where: { orderId: created.id } });
    expect(logs.some((log) => log.action === 'REPROCESS_REQUESTED')).toBeTruthy();
    expect(logs.some((log) => log.action === 'SAGA_COMPLETED')).toBeTruthy();
  });

  it('moves event to DLQ when event consumer keeps failing', async () => {
    const order = await ordersService.create(
      {
        customerId: 'customer-6',
        items: [{ sku: 'SKU-7', qty: 1, price: 7000 }],
      },
      'order-dlq',
    );

    await ordersService.updateStatus(order.id, { status: OrderStatus.PAID });

    const statusChangedEvent = await outboxRepository.findOneOrFail({
      where: {
        aggregateId: order.id,
        eventType: OrderEventType.STATUS_CHANGED,
      },
    });

    failureInjectionService.setRule(`EVENT:${OrderEventType.STATUS_CHANGED}`, 3);

    await outboxProcessor.dispatchPending(100, true);
    await outboxProcessor.dispatchPending(100, true);
    await outboxProcessor.dispatchPending(100, true);

    const deadLettered = await outboxRepository.findOneOrFail({
      where: { id: statusChangedEvent.id },
    });

    expect(deadLettered.status).toBe(OutboxEventStatus.DEAD_LETTER);
    expect(deadLettered.retryCount).toBe(3);

    const deadLetter = await deadLetterRepository.findOne({
      where: { sourceEventId: statusChangedEvent.id },
    });

    expect(deadLetter).toBeTruthy();
    expect(deadLetter?.failedAttemptCount).toBe(3);
  });
});
