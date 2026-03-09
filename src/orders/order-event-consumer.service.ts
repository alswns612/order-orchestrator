import { Injectable } from '@nestjs/common';
import { OutboxEvent } from './entities/outbox-event.entity';
import { OrderEventType } from './order-events.constants';

@Injectable()
export class OrderEventConsumerService {
  private readonly failureRules = new Map<string, number>();

  async consume(event: OutboxEvent): Promise<void> {
    const remainingFailureCount = this.failureRules.get(event.eventType) ?? 0;
    if (remainingFailureCount > 0) {
      this.failureRules.set(event.eventType, remainingFailureCount - 1);
      throw new Error(
        `Injected failure for ${event.eventType}. remaining=${remainingFailureCount - 1}`,
      );
    }

    switch (event.eventType) {
      case OrderEventType.CREATED:
      case OrderEventType.STATUS_CHANGED:
        return;
      default:
        throw new Error(`Unsupported event type: ${event.eventType}`);
    }
  }

  setFailureRule(eventType: string, failCount: number): void {
    if (failCount <= 0) {
      this.failureRules.delete(eventType);
      return;
    }
    this.failureRules.set(eventType, failCount);
  }

  getFailureRules(): Record<string, number> {
    return Object.fromEntries(this.failureRules.entries());
  }
}
