import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'sqlite' as const,
        database: process.env.DATABASE_PATH ?? 'order-orchestrator.sqlite',
        autoLoadEntities: true,
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
