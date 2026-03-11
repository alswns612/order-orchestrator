import { Injectable } from '@nestjs/common';

@Injectable()
export class FailureInjectionService {
  private readonly rules = new Map<string, number>();

  setRule(key: string, failCount: number): void {
    if (failCount <= 0) {
      this.rules.delete(key);
      return;
    }
    this.rules.set(key, failCount);
  }

  getRules(): Record<string, number> {
    return Object.fromEntries(this.rules.entries());
  }

  clear(): void {
    this.rules.clear();
  }

  throwIfConfigured(key: string, message?: string): void {
    const remaining = this.rules.get(key) ?? 0;
    if (remaining <= 0) {
      return;
    }

    this.rules.set(key, remaining - 1);
    throw new Error(message ?? `Injected failure for ${key}. remaining=${remaining - 1}`);
  }
}
