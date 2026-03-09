# Order Orchestrator (NestJS + TypeScript)

주문 처리 안정성을 목표로 한 이벤트 기반 오케스트레이션 MVP입니다.

## Features
- 주문 상태머신: `PENDING -> PAID -> SHIPPED`, `PENDING/PAID -> FAILED`
- 멱등키(`Idempotency-Key`) 기반 중복 생성 방지
- Outbox 패턴: 트랜잭션 내 이벤트 적재
- Outbox 디스패처: 폴링 기반 비동기 발행 처리
- 재시도 + 지수 백오프 + Dead Letter Queue 적재
- 실패 주입 규칙으로 장애 시나리오 재현
- Swagger 문서: `/api-docs`

## Tech Stack
- NestJS 11, TypeScript
- TypeORM + SQLite
- class-validator / class-transformer
- Jest

## Quick Start
```bash
npm install
npm run start:dev
```

## API
- `POST /orders`
- `GET /orders/:id`
- `PATCH /orders/:id/status`

관리자/운영 API:
- `GET /admin/outbox/pending`
- `POST /admin/outbox/dispatch`
- `GET /admin/outbox/dlq`
- `GET /admin/outbox/failure-rules`
- `POST /admin/outbox/failure-rules`

예시: 장애 주입 후 수동 디스패치
```bash
curl -X POST http://localhost:3000/admin/outbox/failure-rules \
  -H 'content-type: application/json' \
  -d '{"eventType":"ORDER_STATUS_CHANGED","failCount":3}'

curl -X POST http://localhost:3000/admin/outbox/dispatch \
  -H 'content-type: application/json' \
  -d '{"limit":20,"force":true}'
```

## Test
```bash
npm run test
npm run test:e2e
```

## Seed
```bash
npm run seed
```

## Docs
- [Architecture](./docs/architecture.md)
