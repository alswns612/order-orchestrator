import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderStateMachineService } from './order-state-machine.service';
import { DeadLetterEvent } from './entities/dead-letter-event.entity';
import { InventoryReservation } from './entities/inventory-reservation.entity';
import { OutboxEvent } from './entities/outbox-event.entity';
import { Order } from './entities/order.entity';
import { Payment } from './entities/payment.entity';
import { Shipment } from './entities/shipment.entity';
import { OrderEventConsumerService } from './order-event-consumer.service';
import { OutboxAdminController } from './outbox-admin.controller';
import { OutboxProcessorService } from './outbox-processor.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      Payment,
      InventoryReservation,
      Shipment,
      OutboxEvent,
      DeadLetterEvent,
    ]),
  ],
  controllers: [OrdersController, OutboxAdminController],
  providers: [
    OrdersService,
    OrderStateMachineService,
    OrderEventConsumerService,
    OutboxProcessorService,
  ],
  exports: [OrdersService, OutboxProcessorService, OrderEventConsumerService],
})
export class OrdersModule {}
