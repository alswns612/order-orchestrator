import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OutboxEventStatus {
  // 발행 대기 상태
  PENDING = 'PENDING',
  // 현재 소비 처리 중 상태
  PROCESSING = 'PROCESSING',
  // 소비 성공 상태
  PUBLISHED = 'PUBLISHED',
  // 재시도 한도 초과로 DLQ 이동 상태
  DEAD_LETTER = 'DEAD_LETTER',
}

@Entity('outbox_events')
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // 어떤 Aggregate에서 발생한 이벤트인지 식별한다.
  @Column({ length: 64 })
  aggregateType!: string;

  @Column({ length: 128 })
  aggregateId!: string;

  @Column({ length: 128 })
  eventType!: string;

  // 이벤트 원문 payload
  @Column({ type: 'simple-json' })
  payload!: Record<string, unknown>;

  @Column({
    type: 'simple-enum',
    enum: OutboxEventStatus,
    default: OutboxEventStatus.PENDING,
  })
  status!: OutboxEventStatus;

  // 현재까지 실패(재시도) 횟수
  @Column({ type: 'integer', default: 0 })
  retryCount!: number;

  // 최대 재시도 허용 횟수
  @Column({ type: 'integer', default: 3 })
  maxRetries!: number;

  // 다음 재시도 예정 시각
  @Column({ type: 'datetime', nullable: true })
  nextRetryAt?: Date | null;

  // 마지막 실패 메시지
  @Column({ type: 'text', nullable: true })
  lastError?: string | null;

  // 발행 성공 시각
  @Column({ type: 'datetime', nullable: true })
  publishedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
