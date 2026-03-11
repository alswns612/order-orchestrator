import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async log(
    orderId: string,
    action: string,
    actor = 'system',
    metadata?: Record<string, unknown>,
    reason?: string,
  ): Promise<AuditLog> {
    const audit = this.auditLogRepository.create({
      orderId,
      action,
      actor,
      metadata: metadata ?? null,
      reason: reason ?? null,
    });

    return this.auditLogRepository.save(audit);
  }

  async findByOrderId(orderId: string, limit = 100): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { orderId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
