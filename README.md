# Order Orchestrator (NestJS + TypeScript)

쇼핑몰 주문 처리 도메인을 기반으로, "실패에 강한 주문 백엔드"를 목표로 만든 토이 프로젝트입니다.  
핵심은 **주문 트랜잭션 정합성 + Outbox 비동기 처리 + 재시도/DLQ 운영성**입니다.

## 1. 프로젝트 목표
- 주문/결제/재고/배송 기본 플로우를 상태머신으로 관리
- Outbox 패턴으로 이벤트 유실 가능성 최소화
- 실패 시 재시도(지수 백오프) 후 DLQ 적재
- 운영 API로 수동 디스패치/실패 주입/DLQ 조회 가능

## 2. 주요 기능
- 주문 상태머신: `PENDING -> PAID -> SHIPPED`, `PENDING/PAID -> FAILED`
- 멱등키(`Idempotency-Key`) 기반 중복 주문 생성 방지
- 주문 생성/상태변경 시 Outbox 이벤트 적재
- Outbox Processor의 주기적 폴링 디스패치
- 재시도(`retryCount`, `nextRetryAt`)와 DLQ(`dead_letter_events`) 관리
- 실패 주입 규칙으로 장애 시나리오 재현
- Swagger 문서: `/api-docs`

## 3. 아키텍처 요약
### 3.1 트랜잭션 경계
`OrdersService`에서 아래를 하나의 DB 트랜잭션으로 처리합니다.
- `orders` 생성
- `payments` 생성
- `inventory_reservations` 생성
- `shipments` 생성
- `outbox_events(ORDER_CREATED)` 생성

즉, 주문 저장과 이벤트 저장이 원자적으로 묶여 "주문은 저장됐는데 이벤트만 유실"되는 케이스를 줄입니다.

### 3.2 Outbox 처리 흐름
1. `outbox_events.status = PENDING` 이벤트 조회
2. `PROCESSING`으로 전환 후 소비 시도
3. 성공 시 `PUBLISHED`
4. 실패 시 `retryCount + 1`, `nextRetryAt` 계산
5. `maxRetries` 도달 시 `DEAD_LETTER` + `dead_letter_events` 적재

## 4. 기술 스택
- NestJS 11, TypeScript
- TypeORM + SQLite
- class-validator / class-transformer
- Jest (unit + e2e-like integration)

## 5. 실행 방법
### 5.1 설치 및 실행
```bash
npm install
npm run start:dev
```

### 5.2 환경 변수
| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `DATABASE_PATH` | `order-orchestrator.sqlite` | SQLite 파일 경로 |
| `OUTBOX_PROCESSOR_ENABLED` | `true` | Outbox 폴링 자동 실행 여부 |
| `OUTBOX_POLL_INTERVAL_MS` | `3000` | Outbox 폴링 주기(ms) |
| `OUTBOX_RETRY_BASE_MS` | `1000` | 재시도 지수 백오프 기준(ms) |

## 6. API 상세
## 6.1 주문 API
### `POST /orders`
주문 생성 (옵션: `Idempotency-Key` 헤더)

요청 예시:
```json
{
  "customerId": "customer-1234",
  "items": [
    { "sku": "SKU-RED-SHIRT", "qty": 2, "price": 19900 }
  ]
}
```

응답 예시(요약):
```json
{
  "id": "uuid",
  "customerId": "customer-1234",
  "status": "PENDING",
  "totalAmount": 39800
}
```

### `GET /orders/:id`
주문 단건 조회

### `PATCH /orders/:id/status`
주문 상태 변경 (상태머신 규칙 검증)

요청 예시:
```json
{
  "status": "PAID"
}
```

## 6.2 운영/관리 API (`/admin/outbox`)
### `GET /admin/outbox/pending?limit=50`
현재 발행 대기 이벤트 조회

### `POST /admin/outbox/dispatch`
Outbox 수동 1회 디스패치

요청 예시:
```json
{
  "limit": 20,
  "force": true
}
```
- `force=true`: `nextRetryAt` 미도래 이벤트도 강제 처리

### `GET /admin/outbox/dlq?limit=50`
DLQ 이벤트 조회

### `POST /admin/outbox/failure-rules`
실패 주입 규칙 설정

요청 예시:
```json
{
  "eventType": "ORDER_STATUS_CHANGED",
  "failCount": 3
}
```

### `GET /admin/outbox/failure-rules`
현재 실패 주입 규칙 조회

## 7. 장애 재현 시나리오 (로컬)
1. 주문 생성 및 상태 변경으로 `ORDER_STATUS_CHANGED` 이벤트 생성
2. 실패 규칙 등록 (`failCount: 3`)
3. `POST /admin/outbox/dispatch`를 3회 호출
4. 이벤트가 `DEAD_LETTER` 상태로 전환되고 DLQ 테이블에 적재되는지 확인

샘플 명령:
```bash
curl -X POST http://localhost:3000/admin/outbox/failure-rules \
  -H 'content-type: application/json' \
  -d '{"eventType":"ORDER_STATUS_CHANGED","failCount":3}'

curl -X POST http://localhost:3000/admin/outbox/dispatch \
  -H 'content-type: application/json' \
  -d '{"limit":20,"force":true}'

curl http://localhost:3000/admin/outbox/dlq
```

## 8. 테스트
```bash
npm run test
npm run test:e2e
```

- `test`: 상태머신/기본 컨트롤러 단위 테스트
- `test:e2e`: 주문 플로우 + Outbox 발행 + 재시도/DLQ 통합 시나리오

## 9. 시드 데이터
```bash
npm run seed
```

## 10. 디렉터리 구조 (핵심)
```txt
src/
  main.ts
  app.module.ts
  orders/
    orders.service.ts
    outbox-processor.service.ts
    outbox-admin.controller.ts
    order-event-consumer.service.ts
    entities/
      order.entity.ts
      payment.entity.ts
      inventory-reservation.entity.ts
      shipment.entity.ts
      outbox-event.entity.ts
      dead-letter-event.entity.ts
```

## 11. 문서
- [Architecture](./docs/architecture.md)
