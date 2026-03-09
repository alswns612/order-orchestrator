export const OrderEventType = {
  CREATED: 'ORDER_CREATED',
  STATUS_CHANGED: 'ORDER_STATUS_CHANGED',
} as const;

export type OrderEventTypeValue =
  (typeof OrderEventType)[keyof typeof OrderEventType];
