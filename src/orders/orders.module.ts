import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminOrdersController } from './admin-orders.controller';
import { AuditLogService } from './audit-log.service';
import { OrderStateMachineService } from './order-state-machine.service';
import { AuditLog } from './entities/audit-log.entity';
import { DeadLetterEvent } from './entities/dead-letter-event.entity';
import { InventoryReservation } from './entities/inventory-reservation.entity';
import { OutboxEvent } from './entities/outbox-event.entity';
import { Order } from './entities/order.entity';
import { Payment } from './entities/payment.entity';
import { Shipment } from './entities/shipment.entity';
import { FailureInjectionService } from './failure-injection.service';
import { OrderEventConsumerService } from './order-event-consumer.service';
import { SagaOrchestratorService } from './saga-orchestrator.service';
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
      AuditLog,
    ]),
  ],
  controllers: [OrdersController, OutboxAdminController, AdminOrdersController],
  providers: [
    OrdersService,
    OrderStateMachineService,
    AuditLogService,
    FailureInjectionService,
    SagaOrchestratorService,
    OrderEventConsumerService,
    OutboxProcessorService,
  ],
  exports: [
    OrdersService,
    OutboxProcessorService,
    OrderEventConsumerService,
    SagaOrchestratorService,
    AuditLogService,
    FailureInjectionService,
  ],
})
export class OrdersModule {}
