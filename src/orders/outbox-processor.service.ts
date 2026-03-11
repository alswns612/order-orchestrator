import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DeadLetterEvent } from './entities/dead-letter-event.entity';
import { OutboxEvent, OutboxEventStatus } from './entities/outbox-event.entity';
import { OrderEventConsumerService } from './order-event-consumer.service';

export interface DispatchResult {
  selected: number;
  published: number;
  retried: number;
  deadLettered: number;
}

@Injectable()
export class OutboxProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxProcessorService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly outboxRepository: Repository<OutboxEvent>,
    @InjectRepository(DeadLetterEvent)
    private readonly deadLetterRepository: Repository<DeadLetterEvent>,
    private readonly eventConsumer: OrderEventConsumerService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    // 기본 동작: 주기적으로 Outbox를 폴링해서 발행 처리한다.
    const enabled = process.env.OUTBOX_PROCESSOR_ENABLED !== 'false';
    if (!enabled) {
      return;
    }

    const pollIntervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 3000);
    this.timer = setInterval(() => {
      void this.dispatchPending(20, false);
    }, pollIntervalMs);

    // 앱 종료를 막지 않도록 unref 처리한다.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async dispatchPending(limit = 20, force = false): Promise<DispatchResult> {
    const query = this.outboxRepository
      .createQueryBuilder('event')
      .where('event.status = :status', { status: OutboxEventStatus.PENDING })
      .orderBy('event.createdAt', 'ASC')
      .take(limit);

    // force=false면 nextRetryAt이 도래한 이벤트만 처리한다.
    if (!force) {
      query.andWhere('(event.nextRetryAt IS NULL OR event.nextRetryAt <= :now)', {
        now: new Date().toISOString(),
      });
    }

    const events = await query.getMany();

    let published = 0;
    let retried = 0;
    let deadLettered = 0;

    for (const event of events) {
      const result = await this.processSingleEvent(event.id);
      if (result === OutboxEventStatus.PUBLISHED) {
        published += 1;
      }
      if (result === OutboxEventStatus.PENDING) {
        retried += 1;
      }
      if (result === OutboxEventStatus.DEAD_LETTER) {
        deadLettered += 1;
      }
    }

    return {
      selected: events.length,
      published,
      retried,
      deadLettered,
    };
  }

  async getPendingEvents(limit = 50): Promise<OutboxEvent[]> {
    return this.outboxRepository.find({
      where: { status: OutboxEventStatus.PENDING },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async getDeadLetterEvents(limit = 50): Promise<DeadLetterEvent[]> {
    return this.deadLetterRepository.find({
      order: { deadLetteredAt: 'DESC' },
      take: limit,
    });
  }

  private async processSingleEvent(id: string): Promise<OutboxEventStatus> {
    const event = await this.outboxRepository.findOne({ where: { id } });
    if (!event || event.status !== OutboxEventStatus.PENDING) {
      return OutboxEventStatus.PENDING;
    }

    // 동시 처리 중복을 줄이기 위해 PROCESSING으로 먼저 전환한다.
    event.status = OutboxEventStatus.PROCESSING;
    await this.outboxRepository.save(event);

    try {
      await this.eventConsumer.consume(event);

      // 소비 성공 시 PUBLISHED 처리
      event.status = OutboxEventStatus.PUBLISHED;
      event.publishedAt = new Date();
      event.lastError = null;
      await this.outboxRepository.save(event);
      return event.status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryCount = event.retryCount + 1;

      if (retryCount >= event.maxRetries) {
        // 재시도 한도 초과 시 Outbox 상태와 DLQ 적재를 한 트랜잭션으로 처리한다.
        await this.dataSource.transaction(async (manager) => {
          event.status = OutboxEventStatus.DEAD_LETTER;
          event.retryCount = retryCount;
          event.lastError = message;
          event.nextRetryAt = null;
          await manager.save(event);

          const deadLetter = manager.create(DeadLetterEvent, {
            sourceEventId: event.id,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            eventType: event.eventType,
            payload: event.payload,
            failedAttemptCount: retryCount,
            errorMessage: message,
          });
          await manager.save(deadLetter);
        });

        this.logger.error(
          `Event moved to DLQ: id=${event.id}, type=${event.eventType}, error=${message}`,
        );
        return OutboxEventStatus.DEAD_LETTER;
      }

      // 재시도 가능하면 PENDING으로 되돌리고 다음 시도 시간을 계산한다.
      event.status = OutboxEventStatus.PENDING;
      event.retryCount = retryCount;
      event.lastError = message;
      event.nextRetryAt = this.calculateNextRetryAt(retryCount);
      await this.outboxRepository.save(event);

      return OutboxEventStatus.PENDING;
    }
  }

  private calculateNextRetryAt(retryCount: number): Date {
    // 지수 백오프: base * 2^(retryCount-1)
    const baseMs = Number(process.env.OUTBOX_RETRY_BASE_MS ?? 1000);
    const delay = Math.max(0, baseMs) * Math.pow(2, Math.max(0, retryCount - 1));
    return new Date(Date.now() + delay);
  }
}
