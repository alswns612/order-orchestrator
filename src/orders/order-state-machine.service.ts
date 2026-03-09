import { ConflictException, Injectable } from '@nestjs/common';
import { OrderStatus } from './order-status.enum';

@Injectable()
export class OrderStateMachineService {
  private readonly allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
    [OrderStatus.PENDING]: [OrderStatus.PAID, OrderStatus.FAILED],
    [OrderStatus.PAID]: [OrderStatus.SHIPPED, OrderStatus.FAILED],
    [OrderStatus.FAILED]: [],
    [OrderStatus.SHIPPED]: [],
  };

  assertTransition(current: OrderStatus, next: OrderStatus): void {
    if (current === next) {
      return;
    }

    const allowed = this.allowedTransitions[current] ?? [];
    if (!allowed.includes(next)) {
      throw new ConflictException(
        `Invalid order state transition: ${current} -> ${next}`,
      );
    }
  }
}
