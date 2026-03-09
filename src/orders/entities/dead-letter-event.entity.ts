import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('dead_letter_events')
export class DeadLetterEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 128 })
  sourceEventId!: string;

  @Column({ length: 64 })
  aggregateType!: string;

  @Column({ length: 128 })
  aggregateId!: string;

  @Column({ length: 128 })
  eventType!: string;

  @Column({ type: 'simple-json' })
  payload!: Record<string, unknown>;

  @Column({ type: 'integer' })
  failedAttemptCount!: number;

  @Column({ type: 'text' })
  errorMessage!: string;

  @CreateDateColumn()
  deadLetteredAt!: Date;
}
