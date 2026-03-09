import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OutboxEventStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  PUBLISHED = 'PUBLISHED',
  DEAD_LETTER = 'DEAD_LETTER',
}

@Entity('outbox_events')
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 64 })
  aggregateType!: string;

  @Column({ length: 128 })
  aggregateId!: string;

  @Column({ length: 128 })
  eventType!: string;

  @Column({ type: 'simple-json' })
  payload!: Record<string, unknown>;

  @Column({
    type: 'simple-enum',
    enum: OutboxEventStatus,
    default: OutboxEventStatus.PENDING,
  })
  status!: OutboxEventStatus;

  @Column({ type: 'integer', default: 0 })
  retryCount!: number;

  @Column({ type: 'integer', default: 3 })
  maxRetries!: number;

  @Column({ type: 'datetime', nullable: true })
  nextRetryAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError?: string | null;

  @Column({ type: 'datetime', nullable: true })
  publishedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
