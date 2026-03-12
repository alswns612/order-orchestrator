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

# 통합 실행 (기존 방식, API + Outbox 폴링을 한 프로세스에서)
npm run start:dev

# 분리 실행 (API와 Worker를 독립 프로세스로)
npm run start:api:dev    # API 전용 (포트 3000, Outbox 폴링 비활성화)
npm run start:worker:dev # Worker 전용 (포트 3001, 헬스체크: GET /health)
```

### 5.2 환경 변수
| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | API 서버 포트 |
| `WORKER_PORT` | `3001` | Worker 헬스체크 포트 |
| `DATABASE_PATH` | `order-orchestrator.sqlite` | SQLite 파일 경로 |
| `OUTBOX_PROCESSOR_ENABLED` | `true` | Outbox 폴링 자동 실행 여부 |
| `OUTBOX_POLL_INTERVAL_MS` | `3000` | Outbox 폴링 주기(ms) |
| `OUTBOX_RETRY_BASE_MS` | `1000` | 재시도 지수 백오프 기준(ms) |
| `OTEL_SERVICE_NAME` | `order-orchestrator` | OpenTelemetry 서비스 이름 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318/v1/traces` | OTLP Trace 수집기 주소 |

### 5.3 관측성 스택 (Prometheus + Grafana + Jaeger)
```bash
docker compose -f docker-compose.observability.yml up -d
```
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3100 (admin/admin)
- Jaeger UI: http://localhost:16686
- 앱 메트릭: http://localhost:3000/metrics

## 6. API 상세
### 6.1 주문 API
- `POST /orders`
- `GET /orders/:id`
- `PATCH /orders/:id/status`

### 6.2 운영 API (Outbox)
- `GET /admin/outbox/pending?limit=50`
- `POST /admin/outbox/dispatch`
- `GET /admin/outbox/dlq?limit=50&offset=0&eventType=ORDER_CREATED`
- `POST /admin/outbox/dlq/:id/reprocess`
- `POST /admin/outbox/dlq/reprocess`
- `GET /admin/outbox/failure-rules`
- `POST /admin/outbox/failure-rules`

`POST /admin/outbox/failure-rules` 예시:
```json
{
  "eventType": "ORDER_STATUS_CHANGED",
  "failCount": 3,
  "ttlMs": 60000
}
```

`POST /admin/outbox/dlq/reprocess` 예시 (배치 재처리):
```json
{
  "ids": ["uuid-1", "uuid-2"],
  "eventType": "ORDER_CREATED"
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
  main.ts              # API 진입점
  app.module.ts
  worker.ts            # Worker 진입점
  worker.module.ts
  common/
    telemetry/
      tracing.ts           # OpenTelemetry Trace SDK 초기화
      metrics.service.ts   # Prometheus 메트릭 서비스
      metrics.controller.ts# /metrics 엔드포인트
      telemetry.module.ts  # Global 텔레메트리 모듈
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

## 12. 남은 전체 개발 계획
현재까지 완료 범위:
- 주문 상태머신 + UUIDv7 주문 ID
- Outbox 재시도/DLQ
- Saga 오케스트레이션 + 보상 트랜잭션
- 운영자 재처리/강제상태변경 + 감사로그
- 운영 신뢰성 강화 (DLQ 재처리, TTL, 멱등 소비)
- API/Worker 프로세스 분리 + graceful shutdown
- 관측성: OpenTelemetry Trace + Prometheus 메트릭 + Grafana/Jaeger

아래는 남은 계획 전체입니다.

### 12.1 ~~1순위: 운영 신뢰성 강화~~ ✅ 완료
- [x] DLQ 재처리 API 구현
- [x] DLQ 배치 재처리(필터/페이지네이션) 구현
- [x] 실패 주입 규칙 TTL(만료시간) 지원
- [x] Outbox Processor 멱등 소비 키(consumer dedup) 도입

완료 기준:
- DLQ 이벤트를 단건/배치로 재처리 가능
- 동일 이벤트 중복 처리 시 상태 불일치가 발생하지 않음

### 12.2 ~~1순위: 실행 구조 분리~~ ✅ 완료
- [x] API 서버와 Worker 프로세스 분리(`start:api`, `start:worker`)
- [x] Worker 헬스체크 엔드포인트 또는 heartbeat 지표 추가
- [x] graceful shutdown(진행 중 작업 정리) 처리

완료 기준:
- API 장애와 Worker 장애가 서로 독립적으로 복구 가능
- 배포 시 Worker 중단/재기동 과정에서 이벤트 유실이 없음

### 12.3 ~~1순위: 관측성(Observability)~~ ✅ 완료
- [x] OpenTelemetry Trace 연동 (Jaeger OTLP exporter)
- [x] Prometheus 메트릭 수집 (`/metrics` 엔드포인트)
- [x] Saga/Outbox/DLQ 비즈니스 메트릭 계측
- [x] Docker Compose 관측성 스택 (Prometheus + Grafana + Jaeger)
- [ ] Grafana 대시보드 JSON 프리셋 추가
- [ ] Alert Rule 추가(DLQ 급증, 재시도 급증, 처리 지연)

구현 메트릭:
- `saga_executions_total{result}` — Saga 실행 결과 (success/compensated)
- `saga_duration_seconds` — Saga 소요 시간 히스토그램
- `saga_step_total{step,result}` — Saga 단계별 성공/실패
- `outbox_dispatch_total{status}` — Outbox 디스패치 결과 (published/retried/dead_lettered)
- `outbox_dispatch_duration_seconds` — 디스패치 사이클 소요 시간
- `outbox_pending_events` — PENDING 이벤트 수 게이지
- `dlq_events_total` — DLQ 적재 건수
- `dlq_reprocess_total{result}` — DLQ 재처리 결과

완료 기준:
- 주문 1건의 전체 Saga 경로를 Trace로 추적 가능 ✅
- `/metrics` 엔드포인트에서 모든 비즈니스 메트릭 확인 가능 ✅

### 12.4 2순위: 인프라 전환
- [ ] DB를 SQLite -> PostgreSQL로 전환
- [ ] Redis/브로커 도입으로 Outbox Polling 보완
- [ ] Docker Compose에 Postgres/Redis/Prometheus/Grafana 통합

완료 기준:
- 로컬에서 `docker compose up`만으로 전체 환경 실행
- DB 전환 후 테스트/빌드/시나리오 모두 통과

### 12.5 2순위: CI/CD 정비
- [ ] GitHub Actions 파이프라인 분리(lint/test/build)
- [ ] 테스트 커버리지 리포트 업로드
- [ ] 브랜치 보호 규칙 + PR 필수 체크 적용
- [ ] dev/stage 자동 배포 파이프라인 구성

완료 기준:
- PR마다 자동 품질 게이트 동작
- main 머지 시 dev 환경 자동 배포

### 12.6 2순위: 품질/성능
- [ ] 부하 테스트(k6) 시나리오 작성
- [ ] 병목 쿼리 인덱스 최적화
- [ ] N+1/락 경합 점검
- [ ] 계약 테스트(CDC) 추가

완료 기준:
- 목표 TPS/응답시간 기준 충족
- 부하 시나리오에서 DLQ 비정상 급증 없음

### 12.7 3순위: 보안/거버넌스
- [ ] 관리자 API 인증/권한(RBAC) 적용
- [ ] 감사 로그 위변조 방지(서명/해시 체인) 적용
- [ ] 민감 정보 마스킹 정책(로그/응답) 정리
- [ ] 보안 점검 문서(Threat Model) 작성

완료 기준:
- 관리자 API 무인증 접근 차단
- 감사로그 신뢰성 검증 가능

### 12.8 포트폴리오 마무리 작업
- [ ] 아키텍처 다이어그램(시퀀스/컴포넌트) 추가
- [ ] 장애 시나리오 데모 스크립트 작성
- [ ] 기술 결정 기록(ADR) 정리
- [ ] 이력서용 5줄 요약 + 링크 정리

완료 기준:
- 면접 시 10분 데모 + 5분 Q&A 대응 가능한 자료 준비 완료

### 12.9 실행 순서(권장)
1. 운영 신뢰성 강화
2. 실행 구조 분리
3. 관측성
4. 인프라 전환
5. CI/CD 정비
6. 품질/성능
7. 보안/거버넌스
8. 포트폴리오 마무리
