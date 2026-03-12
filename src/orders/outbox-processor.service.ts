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

export interface DlqReprocessResult {
  total: number;
  success: number;
  failed: number;
  details: Array<{ id: string; status: 'success' | 'failed'; error?: string }>;
}

@Injectable()
export class OutboxProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxProcessorService.name);
  private timer?: NodeJS.Timeout;
  private activeDispatchCount = 0;
  private shuttingDown = false;

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

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) {
      clearInterval(this.timer);
    }

    // 진행 중인 디스패치가 완료될 때까지 최대 10초 대기한다.
    const deadline = Date.now() + 10_000;
    while (this.activeDispatchCount > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.activeDispatchCount > 0) {
      this.logger.warn(
        `Shutdown timeout: ${this.activeDispatchCount} dispatch(es) still in progress`,
      );
    }
  }

  isHealthy(): boolean {
    return !this.shuttingDown;
  }

  async dispatchPending(limit = 20, force = false): Promise<DispatchResult> {
    if (this.shuttingDown) {
      return { selected: 0, published: 0, retried: 0, deadLettered: 0 };
    }

    this.activeDispatchCount += 1;
    try {
      return await this._doDispatch(limit, force);
    } finally {
      this.activeDispatchCount -= 1;
    }
  }

  private async _doDispatch(limit: number, force: boolean): Promise<DispatchResult> {
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

  async getDeadLetterEvents(
    limit = 50,
    offset = 0,
    eventType?: string,
  ): Promise<{ data: DeadLetterEvent[]; total: number }> {
    const query = this.deadLetterRepository.createQueryBuilder('dle');

    if (eventType) {
      query.where('dle.eventType = :eventType', { eventType });
    }

    query.orderBy('dle.deadLetteredAt', 'DESC').skip(offset).take(limit);

    const [data, total] = await query.getManyAndCount();
    return { data, total };
  }

  async reprocessDlqEvent(dlqId: string): Promise<void> {
    const dlqEvent = await this.deadLetterRepository.findOne({
      where: { id: dlqId },
    });
    if (!dlqEvent) {
      throw new Error(`DLQ event not found: ${dlqId}`);
    }

    // 원본 Outbox 이벤트를 PENDING으로 복원하고 DLQ 레코드를 삭제한다.
    await this.dataSource.transaction(async (manager) => {
      const outboxEvent = await manager.findOne(OutboxEvent, {
        where: { id: dlqEvent.sourceEventId },
      });

      if (outboxEvent) {
        outboxEvent.status = OutboxEventStatus.PENDING;
        outboxEvent.retryCount = 0;
        outboxEvent.lastError = null;
        outboxEvent.nextRetryAt = null;
        await manager.save(outboxEvent);
      } else {
        // 원본이 없으면 새 Outbox 이벤트를 생성한다.
        const newEvent = manager.create(OutboxEvent, {
          aggregateType: dlqEvent.aggregateType,
          aggregateId: dlqEvent.aggregateId,
          eventType: dlqEvent.eventType,
          payload: dlqEvent.payload,
          status: OutboxEventStatus.PENDING,
          retryCount: 0,
          maxRetries: 3,
        });
        await manager.save(newEvent);
      }

      await manager.remove(dlqEvent);
    });
  }

  async reprocessDlqBatch(
    ids?: string[],
    eventType?: string,
  ): Promise<DlqReprocessResult> {
    let targets: DeadLetterEvent[];

    if (ids && ids.length > 0) {
      targets = await this.deadLetterRepository.find({
        where: ids.map((id) => ({ id })),
      });
    } else {
      const query = this.deadLetterRepository.createQueryBuilder('dle');
      if (eventType) {
        query.where('dle.eventType = :eventType', { eventType });
      }
      query.take(100);
      targets = await query.getMany();
    }

    const result: DlqReprocessResult = {
      total: targets.length,
      success: 0,
      failed: 0,
      details: [],
    };

    for (const dlqEvent of targets) {
      try {
        await this.reprocessDlqEvent(dlqEvent.id);
        result.success += 1;
        result.details.push({ id: dlqEvent.id, status: 'success' });
      } catch (error) {
        result.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        result.details.push({ id: dlqEvent.id, status: 'failed', error: message });
      }
    }

    return result;
  }

  private async processSingleEvent(id: string): Promise<OutboxEventStatus> {
    // 원자적 UPDATE로 PENDING → PROCESSING 전환하여 동시 소비를 방지한다.
    const claimed = await this.outboxRepository
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({ status: OutboxEventStatus.PROCESSING })
      .where('id = :id AND status = :status', {
        id,
        status: OutboxEventStatus.PENDING,
      })
      .execute();

    // affected가 0이면 이미 다른 프로세스가 선점했거나 상태가 PENDING이 아니다.
    if (!claimed.affected || claimed.affected === 0) {
      return OutboxEventStatus.PENDING;
    }

    const event = await this.outboxRepository.findOne({ where: { id } });
    if (!event) {
      return OutboxEventStatus.PENDING;
    }

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
