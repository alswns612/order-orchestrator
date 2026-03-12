// OpenTelemetry SDK는 다른 모듈보다 먼저 초기화해야 한다.
import './common/telemetry/tracing';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { OutboxProcessorService } from './orders/outbox-processor.service';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const logger = new Logger('Worker');

  // Worker는 Outbox 폴링을 활성화한 상태로 기동한다.
  process.env.OUTBOX_PROCESSOR_ENABLED = process.env.OUTBOX_PROCESSOR_ENABLED ?? 'true';

  const app = await NestFactory.create(WorkerModule);

  // 헬스체크용 최소 HTTP 서버 (별도 포트)
  const workerPort = Number(process.env.WORKER_PORT ?? 3001);

  const outboxProcessor = app.get(OutboxProcessorService);

  // NestJS enableShutdownHooks로 SIGTERM/SIGINT 시 onModuleDestroy가 호출된다.
  app.enableShutdownHooks();

  // 헬스체크 엔드포인트를 Express 레벨에서 직접 등록한다.
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/health', (_req: unknown, res: { json: (body: unknown) => void }) => {
    const healthy = outboxProcessor.isHealthy();
    res.json({ status: healthy ? 'ok' : 'shutting_down' });
  });

  await app.listen(workerPort);
  logger.log(`Worker started on port ${workerPort} (health: GET /health)`);
}

void bootstrap();
