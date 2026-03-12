// OpenTelemetry SDK는 다른 모듈보다 먼저 초기화해야 한다.
import './common/telemetry/tracing';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  // 애플리케이션 루트 모듈을 기준으로 Nest 앱을 생성한다.
  const app = await NestFactory.create(AppModule);

  // DTO 기반 유효성 검증을 전역 적용한다.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 예외 응답 포맷을 통일한다.
  app.useGlobalFilters(new HttpExceptionFilter());

  // API 문서(Swagger)를 /api-docs 경로에 노출한다.
  const config = new DocumentBuilder()
    .setTitle('Order Orchestrator API')
    .setDescription('Order/Outbox/DLQ 운영 시나리오를 위한 API')
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
