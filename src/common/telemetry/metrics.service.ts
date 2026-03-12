/**
 * Prometheus 메트릭 서비스
 * - prom-client를 사용하여 비즈니스 메트릭을 수집한다.
 * - /metrics 엔드포인트를 통해 Prometheus가 스크랩할 수 있다.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  // --- Saga 메트릭 ---

  /** Saga 실행 횟수 (성공/실패/보상 라벨 포함) */
  readonly sagaTotal: Counter;

  /** Saga 실행 소요 시간 (초 단위 히스토그램) */
  readonly sagaDuration: Histogram;

  /** Saga 단계별 실행 횟수 (step + result 라벨) */
  readonly sagaStepTotal: Counter;

  // --- Outbox 메트릭 ---

  /** Outbox 디스패치 이벤트 수 (status 라벨: published, retried, dead_lettered) */
  readonly outboxDispatchTotal: Counter;

  /** Outbox 디스패치 사이클 소요 시간 */
  readonly outboxDispatchDuration: Histogram;

  /** Outbox 대기(PENDING) 이벤트 수 게이지 */
  readonly outboxPendingGauge: Gauge;

  // --- DLQ 메트릭 ---

  /** DLQ 적재 건수 */
  readonly dlqTotal: Counter;

  /** DLQ 재처리 결과 (success/failed) */
  readonly dlqReprocessTotal: Counter;

  constructor() {
    this.sagaTotal = new Counter({
      name: 'saga_executions_total',
      help: 'Saga 실행 총 횟수',
      labelNames: ['result'] as const, // success, failed, compensated
      registers: [this.registry],
    });

    this.sagaDuration = new Histogram({
      name: 'saga_duration_seconds',
      help: 'Saga 실행 소요 시간(초)',
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    this.sagaStepTotal = new Counter({
      name: 'saga_step_total',
      help: 'Saga 단계별 실행 횟수',
      labelNames: ['step', 'result'] as const,
      registers: [this.registry],
    });

    this.outboxDispatchTotal = new Counter({
      name: 'outbox_dispatch_total',
      help: 'Outbox 디스패치 이벤트 수',
      labelNames: ['status'] as const,
      registers: [this.registry],
    });

    this.outboxDispatchDuration = new Histogram({
      name: 'outbox_dispatch_duration_seconds',
      help: 'Outbox 디스패치 사이클 소요 시간(초)',
      buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
      registers: [this.registry],
    });

    this.outboxPendingGauge = new Gauge({
      name: 'outbox_pending_events',
      help: '현재 PENDING 상태 Outbox 이벤트 수',
      registers: [this.registry],
    });

    this.dlqTotal = new Counter({
      name: 'dlq_events_total',
      help: 'DLQ 적재 총 건수',
      registers: [this.registry],
    });

    this.dlqReprocessTotal = new Counter({
      name: 'dlq_reprocess_total',
      help: 'DLQ 재처리 결과',
      labelNames: ['result'] as const,
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.registry });
  }
}
