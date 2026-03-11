# Order Orchestrator (NestJS + TypeScript)

쇼핑몰 주문 처리 도메인을 기반으로, "실패에 강한 주문 백엔드"를 목표로 만든 토이 프로젝트입니다.  
핵심은 **주문 트랜잭션 정합성 + UUIDv7 주문 ID + Outbox 비동기 처리 + Saga 보상 트랜잭션 + 운영 재처리**입니다.

## 1. 프로젝트 목표
- 주문/결제/재고/배송 기본 플로우를 상태머신으로 관리
- UUIDv7 기반 주문 ID 생성 및 DB 유니크 제약으로 충돌 방지
- Outbox 패턴으로 이벤트 유실 가능성 최소화
- 실패 시 재시도(지수 백오프) 후 DLQ 적재
- Saga 실패 시 보상 트랜잭션(결제 취소, 재고 해제, 주문 실패 처리)
- 운영 API로 수동 디스패치/실패 주입/재처리/감사로그 조회 가능

## 2. 주요 기능
- 주문 상태머신: `PENDING -> PAID -> SHIPPED`, `PENDING/PAID -> FAILED`
- 주문 ID: 애플리케이션 레벨 `UUIDv7` 생성
- 멱등키(`Idempotency-Key`) 기반 중복 주문 생성 방지
- 주문 생성/상태변경 시 Outbox 이벤트 적재
- Outbox Processor의 주기적 폴링 디스패치
- 재시도(`retryCount`, `nextRetryAt`)와 DLQ(`dead_letter_events`) 관리
- `ORDER_CREATED` 이벤트 기반 Saga 오케스트레이션
- 실패 주입 규칙으로 이벤트/사가 단계 장애 시나리오 재현

## 3. 아키텍처 요약
### 3.1 트랜잭션 경계
`OrdersService.create`에서 아래를 하나의 DB 트랜잭션으로 처리합니다.
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

### 3.3 Saga 처리 흐름
1. `ORDER_CREATED` 이벤트 소비
2. 결제 승인
3. 주문 상태 `PAID`
4. 재고 확정
5. 배송 요청
6. 주문 상태 `SHIPPED`

실패 시 보상:
- 재고 확정 이후 실패: 재고 `RELEASED`
- 결제 승인 이후 실패: 결제 `CANCELLED`
- 주문 상태 강제 `FAILED`

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
### 6.1 주문 API
- `POST /orders`
- `GET /orders/:id`
- `PATCH /orders/:id/status`

### 6.2 운영 API (Outbox)
- `GET /admin/outbox/pending?limit=50`
- `POST /admin/outbox/dispatch`
- `GET /admin/outbox/dlq?limit=50`
- `GET /admin/outbox/failure-rules`
- `POST /admin/outbox/failure-rules`

`POST /admin/outbox/failure-rules` 예시:
```json
{
  "eventType": "ORDER_STATUS_CHANGED",
  "failCount": 3
}
```

### 6.3 운영 API (Orders)
- `POST /admin/orders/:id/reprocess`
- `POST /admin/orders/:id/force-status`
- `GET /admin/orders/:id/audit-logs`
- `GET /admin/orders/failure-points`
- `POST /admin/orders/failure-points`

`POST /admin/orders/failure-points` 예시 (사가 단계 장애 주입):
```json
{
  "key": "SAGA:SHIPMENT_REQUEST",
  "failCount": 1
}
```

## 7. 장애 재현 시나리오 (로컬)
1. 주문 생성
2. `SAGA:SHIPMENT_REQUEST` 실패 주입
3. Outbox dispatch 실행
4. 주문 `FAILED`, 결제 `CANCELLED`, 재고 `RELEASED` 확인
5. `POST /admin/orders/:id/reprocess`로 재처리
6. 주문 `SHIPPED` 복구 확인

## 8. 테스트
```bash
npm run test
npm run test:e2e
```

- `test`: UUIDv7/상태머신 단위 테스트
- `test:e2e`: 주문 플로우 + Saga 성공/보상/재처리 + DLQ 통합 시나리오

## 9. 시드 데이터
```bash
npm run seed
```

## 10. 디렉터리 구조 (핵심)
```txt
src/
  main.ts
  app.module.ts
  common/
    utils/
      uuidv7.util.ts
  orders/
    orders.service.ts
    saga-orchestrator.service.ts
    outbox-processor.service.ts
    admin-orders.controller.ts
    outbox-admin.controller.ts
    audit-log.service.ts
    failure-injection.service.ts
    entities/
      order.entity.ts
      payment.entity.ts
      inventory-reservation.entity.ts
      shipment.entity.ts
      outbox-event.entity.ts
      dead-letter-event.entity.ts
      audit-log.entity.ts
```

## 11. 문서
- [Architecture](./docs/architecture.md)
