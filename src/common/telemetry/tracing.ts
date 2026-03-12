/**
 * OpenTelemetry Trace SDK 초기화
 * - main.ts / worker.ts 진입점 최상단에서 import하여 트레이싱을 활성화한다.
 * - OTLP exporter로 Jaeger/Tempo 등 외부 수집기에 span을 전송한다.
 * - OTEL_EXPORTER_OTLP_ENDPOINT 환경변수로 수집기 주소를 설정한다.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';

const serviceName = process.env.OTEL_SERVICE_NAME ?? 'order-orchestrator';

const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
});

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
  }),
  spanProcessors: [new BatchSpanProcessor(traceExporter)],
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
  ],
});

sdk.start();

// 프로세스 종료 시 버퍼에 남은 span을 flush한다.
process.on('SIGTERM', () => {
  sdk.shutdown().catch(console.error);
});
