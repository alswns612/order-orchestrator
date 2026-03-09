import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DeadLetterEvent } from '../src/orders/entities/dead-letter-event.entity';
import {
  OutboxEvent,
  OutboxEventStatus,
} from '../src/orders/entities/outbox-event.entity';
import { OrderEventConsumerService } from '../src/orders/order-event-consumer.service';
import { OrderEventType } from '../src/orders/order-events.constants';
import { OrderStatus } from '../src/orders/order-status.enum';
import { OrdersService } from '../src/orders/orders.service';
import { OutboxProcessorService } from '../src/orders/outbox-processor.service';

describe('Orders Flow (e2e-like integration)', () => {
  let app: INestApplication;
  let ordersService: OrdersService;
  let outboxProcessor: OutboxProcessorService;
  let eventConsumer: OrderEventConsumerService;
  let outboxRepository: Repository<OutboxEvent>;
  let deadLetterRepository: Repository<DeadLetterEvent>;

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
    eventConsumer = app.get(OrderEventConsumerService);
    outboxRepository = app.get<Repository<OutboxEvent>>(
      getRepositoryToken(OutboxEvent),
    );
    deadLetterRepository = app.get<Repository<DeadLetterEvent>>(
      getRepositoryToken(DeadLetterEvent),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates and loads an order', async () => {
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

  it('publishes pending outbox event', async () => {
    const order = await ordersService.create(
      {
        customerId: 'customer-4',
        items: [{ sku: 'SKU-5', qty: 1, price: 2200 }],
      },
      'order-002',
    );

    const createdEvent = await outboxRepository.findOne({
      where: {
        aggregateId: order.id,
        eventType: OrderEventType.CREATED,
      },
    });

    expect(createdEvent).toBeTruthy();
    expect(createdEvent?.status).toBe(OutboxEventStatus.PENDING);

    await outboxProcessor.dispatchPending(50, true);

    const publishedEvent = await outboxRepository.findOneOrFail({
      where: { id: createdEvent!.id },
    });

    expect(publishedEvent.status).toBe(OutboxEventStatus.PUBLISHED);
    expect(publishedEvent.publishedAt).toBeTruthy();
  });

  it('retries then moves to DLQ when consumer keeps failing', async () => {
    const order = await ordersService.create(
      {
        customerId: 'customer-5',
        items: [{ sku: 'SKU-6', qty: 1, price: 5000 }],
      },
      'order-003',
    );
    await ordersService.updateStatus(order.id, { status: OrderStatus.PAID });

    const statusChangedEvent = await outboxRepository.findOneOrFail({
      where: {
        aggregateId: order.id,
        eventType: OrderEventType.STATUS_CHANGED,
      },
    });

    eventConsumer.setFailureRule(OrderEventType.STATUS_CHANGED, 3);

    await outboxProcessor.dispatchPending(50, true);
    await outboxProcessor.dispatchPending(50, true);
    await outboxProcessor.dispatchPending(50, true);

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
