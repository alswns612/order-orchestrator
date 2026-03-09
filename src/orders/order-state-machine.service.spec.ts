import { ConflictException } from '@nestjs/common';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrderStatus } from './order-status.enum';

describe('OrderStateMachineService', () => {
  let service: OrderStateMachineService;

  beforeEach(() => {
    service = new OrderStateMachineService();
  });

  it('allows PENDING -> PAID', () => {
    expect(() => {
      service.assertTransition(OrderStatus.PENDING, OrderStatus.PAID);
    }).not.toThrow();
  });

  it('allows PAID -> SHIPPED', () => {
    expect(() => {
      service.assertTransition(OrderStatus.PAID, OrderStatus.SHIPPED);
    }).not.toThrow();
  });

  it('throws conflict on invalid transition', () => {
    expect(() => {
      service.assertTransition(OrderStatus.PENDING, OrderStatus.SHIPPED);
    }).toThrow(ConflictException);
  });
});
