import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ length: 36 })
  orderId!: string;

  @Column({ length: 64 })
  action!: string;

  @Column({ length: 64, default: 'system' })
  actor!: string;

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @Column({ type: 'simple-json', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;
}
