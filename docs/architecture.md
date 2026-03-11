# Architecture Overview

## Domain
- Order status machine: `PENDING -> PAID -> SHIPPED` or `PENDING/PAID -> FAILED`
- Core entities:
  - `Order`, `Payment`, `InventoryReservation`, `Shipment`
  - `OutboxEvent`, `DeadLetterEvent`
  - `AuditLog`

## ID Strategy
- `orders.id`는 애플리케이션에서 UUIDv7로 생성
- DB PK/UNIQUE 제약으로 최종 유일성 보장
- 충돌 시 제한 횟수 재생성 재시도

## Outbox Flow
1. 주문 트랜잭션에서 `OutboxEvent(PENDING)` 저장
2. `OutboxProcessorService`가 폴링으로 PENDING 이벤트 조회
3. `OrderEventConsumerService`에서 이벤트 소비
4. 성공 시 `PUBLISHED`, 실패 시 `retryCount` 증가 + `nextRetryAt` 설정
5. `maxRetries` 초과 시 `DEAD_LETTER` 전환 및 `DeadLetterEvent` 적재

## Saga Flow (ORDER_CREATED)
1. 결제 승인
2. 주문 상태 `PAID`
3. 재고 확정
4. 배송 요청
5. 주문 상태 `SHIPPED`

### Compensation
- 배송 단계 실패 등 후반 실패 시:
  - 재고 `RELEASED`
  - 결제 `CANCELLED`
  - 주문 상태 `FAILED`

## Ops API
- Outbox 운영:
  - `POST /admin/outbox/dispatch`
  - `GET /admin/outbox/dlq`
- Order 운영:
  - `POST /admin/orders/:id/reprocess`
  - `POST /admin/orders/:id/force-status`
  - `GET /admin/orders/:id/audit-logs`
