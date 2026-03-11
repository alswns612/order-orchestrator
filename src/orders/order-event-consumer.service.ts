import { Injectable } from '@nestjs/common';
import { OutboxEvent } from './entities/outbox-event.entity';
import { OrderEventType } from './order-events.constants';

@Injectable()
export class OrderEventConsumerService {
  // eventType별 강제 실패 횟수(운영/테스트 시나리오 재현용)
  private readonly failureRules = new Map<string, number>();

  async consume(event: OutboxEvent): Promise<void> {
    // 실패 주입 규칙이 있으면 의도적으로 에러를 발생시켜 재시도/DLQ 흐름을 검증한다.
    const remainingFailureCount = this.failureRules.get(event.eventType) ?? 0;
    if (remainingFailureCount > 0) {
      this.failureRules.set(event.eventType, remainingFailureCount - 1);
      throw new Error(
        `Injected failure for ${event.eventType}. remaining=${remainingFailureCount - 1}`,
      );
    }

    // 현재는 데모 목적의 소비기라서 이벤트 타입 검증만 수행한다.
    switch (event.eventType) {
      case OrderEventType.CREATED:
      case OrderEventType.STATUS_CHANGED:
        return;
      default:
        throw new Error(`Unsupported event type: ${event.eventType}`);
    }
  }

  setFailureRule(eventType: string, failCount: number): void {
    // failCount가 0 이하이면 규칙 삭제로 간주한다.
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
