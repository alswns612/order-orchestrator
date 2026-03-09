# Architecture Overview

## Domain
- Order status machine: `PENDING -> PAID -> SHIPPED` or `PENDING/PAID -> FAILED`
- Core entities: `Order`, `Payment`, `InventoryReservation`, `Shipment`, `OutboxEvent`, `DeadLetterEvent`

## Outbox Flow
1. 주문 트랜잭션에서 `OutboxEvent(PENDING)` 저장
2. `OutboxProcessorService`가 폴링으로 PENDING 이벤트 조회
3. `OrderEventConsumerService`에서 이벤트 소비
4. 성공 시 `PUBLISHED`, 실패 시 `retryCount` 증가 + `nextRetryAt` 설정
5. `maxRetries` 초과 시 `DEAD_LETTER` 상태로 전환 및 `DeadLetterEvent` 적재

## Reliability Notes
- Idempotency: 동일 `Idempotency-Key` 요청은 기존 주문 반환
- Retry: 지수 백오프 (`OUTBOX_RETRY_BASE_MS` 기반)
- DLQ: 재시도 한도 초과 이벤트를 별도 테이블에 보관
- Failure Injection: eventType별 실패 횟수 주입 가능

## API
- `POST /orders` create order
- `GET /orders/:id` get order
- `PATCH /orders/:id/status` update order status
- `POST /admin/outbox/dispatch` dispatch pending events
- `GET /admin/outbox/dlq` inspect DLQ events
