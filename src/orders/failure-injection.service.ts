import { Injectable } from '@nestjs/common';

interface FailureRule {
  failCount: number;
  expiresAt?: Date | null;
}

@Injectable()
export class FailureInjectionService {
  private readonly rules = new Map<string, FailureRule>();

  setRule(key: string, failCount: number, ttlMs?: number): void {
    if (failCount <= 0) {
      this.rules.delete(key);
      return;
    }
    const expiresAt = ttlMs && ttlMs > 0 ? new Date(Date.now() + ttlMs) : null;
    this.rules.set(key, { failCount, expiresAt });
  }

  getRules(): Record<string, { failCount: number; expiresAt: string | null }> {
    this.purgeExpired();
    const result: Record<string, { failCount: number; expiresAt: string | null }> = {};
    for (const [key, rule] of this.rules.entries()) {
      result[key] = {
        failCount: rule.failCount,
        expiresAt: rule.expiresAt?.toISOString() ?? null,
      };
    }
    return result;
  }

  clear(): void {
    this.rules.clear();
  }

  throwIfConfigured(key: string, message?: string): void {
    const rule = this.rules.get(key);
    if (!rule || rule.failCount <= 0) {
      return;
    }

    // TTL 만료 시 규칙을 자동 해제한다.
    if (rule.expiresAt && rule.expiresAt.getTime() < Date.now()) {
      this.rules.delete(key);
      return;
    }

    rule.failCount -= 1;
    if (rule.failCount <= 0) {
      this.rules.delete(key);
    }
    throw new Error(message ?? `Injected failure for ${key}. remaining=${rule.failCount}`);
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, rule] of this.rules.entries()) {
      if (rule.expiresAt && rule.expiresAt.getTime() < now) {
        this.rules.delete(key);
      }
    }
  }
}
