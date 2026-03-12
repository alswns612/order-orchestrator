import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelemetryModule } from './common/telemetry/telemetry.module';
import { AuditLog } from './orders/entities/audit-log.entity';
import { DeadLetterEvent } from './orders/entities/dead-letter-event.entity';
import { InventoryReservation } from './orders/entities/inventory-reservation.entity';
import { Order } from './orders/entities/order.entity';
import { OutboxEvent } from './orders/entities/outbox-event.entity';
import { Payment } from './orders/entities/payment.entity';
import { Shipment } from './orders/entities/shipment.entity';
import { AuditLogService } from './orders/audit-log.service';
import { FailureInjectionService } from './orders/failure-injection.service';
import { OrderEventConsumerService } from './orders/order-event-consumer.service';
import { OrderStateMachineService } from './orders/order-state-machine.service';
import { OrdersService } from './orders/orders.service';
import { OutboxProcessorService } from './orders/outbox-processor.service';
import { SagaOrchestratorService } from './orders/saga-orchestrator.service';

@Module({
  imports: [
    TelemetryModule,
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'sqlite' as const,
        database: process.env.DATABASE_PATH ?? 'order-orchestrator.sqlite',
        autoLoadEntities: true,
        synchronize: true,
        retryAttempts: 1,
        retryDelay: 0,
      }),
    }),
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
  providers: [
    OrdersService,
    OrderStateMachineService,
    AuditLogService,
    FailureInjectionService,
    SagaOrchestratorService,
    OrderEventConsumerService,
    OutboxProcessorService,
  ],
})
export class WorkerModule {}
