import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { TelemetryModule } from './common/telemetry/telemetry.module';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [
    TelemetryModule,
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'sqlite' as const,
        // 기본 DB 파일 경로는 프로젝트 루트의 sqlite 파일이다.
        database: process.env.DATABASE_PATH ?? 'order-orchestrator.sqlite',
        autoLoadEntities: true,
        // 토이 프로젝트 편의를 위해 synchronize=true를 사용한다.
        synchronize: true,
        retryAttempts: 1,
        retryDelay: 0,
      }),
    }),
    OrdersModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
