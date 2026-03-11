import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('dead_letter_events')
export class DeadLetterEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // 원본 outbox_events.id
  @Column({ length: 128 })
  sourceEventId!: string;

  @Column({ length: 64 })
  aggregateType!: string;

  @Column({ length: 128 })
  aggregateId!: string;

  @Column({ length: 128 })
  eventType!: string;

  // 장애 분석을 위해 원본 payload를 그대로 남긴다.
  @Column({ type: 'simple-json' })
  payload!: Record<string, unknown>;

  // DLQ로 이동될 때까지 누적된 실패 횟수
  @Column({ type: 'integer' })
  failedAttemptCount!: number;

  // 마지막 실패 에러 메시지
  @Column({ type: 'text' })
  errorMessage!: string;

  @CreateDateColumn()
  deadLetteredAt!: Date;
}
