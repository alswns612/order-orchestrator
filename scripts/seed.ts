import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { InventoryReservation } from '../src/orders/entities/inventory-reservation.entity';
import { OutboxEvent } from '../src/orders/entities/outbox-event.entity';
import { OrderEventType } from '../src/orders/order-events.constants';
import { Order, OrderLineItem } from '../src/orders/entities/order.entity';
import { OrderStatus } from '../src/orders/order-status.enum';
import { Payment, PaymentStatus } from '../src/orders/entities/payment.entity';
import { Shipment, ShipmentStatus } from '../src/orders/entities/shipment.entity';

const dataSource = new DataSource({
  type: 'sqlite',
  database: process.env.DATABASE_PATH ?? 'order-orchestrator.sqlite',
  entities: [Order, Payment, InventoryReservation, Shipment, OutboxEvent],
  synchronize: true,
});

async function run(): Promise<void> {
  await dataSource.initialize();

  const orderRepository = dataSource.getRepository(Order);
  const existing = await orderRepository.findOne({
    where: { idempotencyKey: 'seed-order-1' },
  });

  if (existing) {
    console.log(`seed already exists: ${existing.id}`);
    await dataSource.destroy();
    return;
  }

  const items: OrderLineItem[] = [{ sku: 'SEED-SKU-1', qty: 1, price: 12000 }];

  const order = orderRepository.create({
    customerId: 'seed-customer',
    items,
    totalAmount: 12000,
    status: OrderStatus.PENDING,
    idempotencyKey: 'seed-order-1',
  });

  const savedOrder = await orderRepository.save(order);

  await dataSource.getRepository(Payment).save(
    dataSource.getRepository(Payment).create({
      orderId: savedOrder.id,
      amount: 12000,
      status: PaymentStatus.PENDING,
    }),
  );

  await dataSource.getRepository(InventoryReservation).save(
    dataSource.getRepository(InventoryReservation).create({
      orderId: savedOrder.id,
      reservations: [{ sku: 'SEED-SKU-1', qty: 1 }],
    }),
  );

  await dataSource.getRepository(Shipment).save(
    dataSource.getRepository(Shipment).create({
      orderId: savedOrder.id,
      status: ShipmentStatus.REQUESTED,
    }),
  );

  await dataSource.getRepository(OutboxEvent).save(
    dataSource.getRepository(OutboxEvent).create({
      aggregateType: 'Order',
      aggregateId: savedOrder.id,
      eventType: OrderEventType.CREATED,
      payload: { orderId: savedOrder.id, seeded: true },
    }),
  );

  console.log(`seed created: ${savedOrder.id}`);
  await dataSource.destroy();
}

void run();
