import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DispatchOutboxDto } from './dto/dispatch-outbox.dto';
import { SetFailureRuleDto } from './dto/set-failure-rule.dto';
import { OrderEventConsumerService } from './order-event-consumer.service';
import { OutboxProcessorService } from './outbox-processor.service';

@ApiTags('admin-outbox')
@Controller('admin/outbox')
export class OutboxAdminController {
  constructor(
    private readonly outboxProcessor: OutboxProcessorService,
    private readonly eventConsumer: OrderEventConsumerService,
  ) {}

  @Get('pending')
  @ApiOperation({ summary: 'List pending outbox events' })
  async getPending(@Query('limit') limit?: string) {
    const parsedLimit = Number(limit ?? 50);
    return this.outboxProcessor.getPendingEvents(parsedLimit);
  }

  @Post('dispatch')
  @ApiOperation({ summary: 'Dispatch pending outbox events once' })
  async dispatch(@Body() dto: DispatchOutboxDto) {
    return this.outboxProcessor.dispatchPending(dto.limit ?? 20, dto.force ?? false);
  }

  @Get('dlq')
  @ApiOperation({ summary: 'List dead-letter events' })
  async getDlq(@Query('limit') limit?: string) {
    const parsedLimit = Number(limit ?? 50);
    return this.outboxProcessor.getDeadLetterEvents(parsedLimit);
  }

  @Get('failure-rules')
  @ApiOperation({ summary: 'Read current failure injection rules' })
  getFailureRules() {
    return this.eventConsumer.getFailureRules();
  }

  @Post('failure-rules')
  @ApiOperation({ summary: 'Set failure injection rule by eventType' })
  setFailureRule(@Body() dto: SetFailureRuleDto) {
    this.eventConsumer.setFailureRule(dto.eventType, dto.failCount);
    return this.eventConsumer.getFailureRules();
  }
}
