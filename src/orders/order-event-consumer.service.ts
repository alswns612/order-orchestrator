import { Injectable } from '@nestjs/common';
import { OutboxEvent } from './entities/outbox-event.entity';
import { FailureInjectionService } from './failure-injection.service';
import { OrderEventType } from './order-events.constants';
import { SagaOrchestratorService } from './saga-orchestrator.service';

@Injectable()
export class OrderEventConsumerService {
  constructor(
    private readonly sagaOrchestratorService: SagaOrchestratorService,
    private readonly failureInjectionService: FailureInjectionService,
  ) {}

  async consume(event: OutboxEvent): Promise<void> {
    // 이벤트 단위 실패 주입(재시도/DLQ 검증용)
    this.failureInjectionService.throwIfConfigured(
      `EVENT:${event.eventType}`,
      `Injected failure for ${event.eventType}`,
    );

    switch (event.eventType) {
      case OrderEventType.CREATED:
        await this.sagaOrchestratorService.handleOrderCreated(event.aggregateId);
        return;
      case OrderEventType.STATUS_CHANGED:
        return;
      default:
        throw new Error(`Unsupported event type: ${event.eventType}`);
    }
  }
}
