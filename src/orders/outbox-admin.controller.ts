import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DispatchOutboxDto } from './dto/dispatch-outbox.dto';
import { SetFailureRuleDto } from './dto/set-failure-rule.dto';
import { FailureInjectionService } from './failure-injection.service';
import { OutboxProcessorService } from './outbox-processor.service';

@ApiTags('admin-outbox')
@Controller('admin/outbox')
export class OutboxAdminController {
  constructor(
    private readonly outboxProcessor: OutboxProcessorService,
    private readonly failureInjectionService: FailureInjectionService,
  ) {}

  @Get('pending')
  @ApiOperation({ summary: '대기 중인 Outbox 이벤트 조회' })
  async getPending(@Query('limit') limit?: string) {
    const parsedLimit = Number(limit ?? 50);
    return this.outboxProcessor.getPendingEvents(parsedLimit);
  }

  @Post('dispatch')
  @ApiOperation({ summary: 'Outbox 이벤트를 1회 수동 디스패치' })
  async dispatch(@Body() dto: DispatchOutboxDto) {
    return this.outboxProcessor.dispatchPending(dto.limit ?? 20, dto.force ?? false);
  }

  @Get('dlq')
  @ApiOperation({ summary: 'Dead Letter Queue 이벤트 조회' })
  async getDlq(@Query('limit') limit?: string) {
    const parsedLimit = Number(limit ?? 50);
    return this.outboxProcessor.getDeadLetterEvents(parsedLimit);
  }

  @Get('failure-rules')
  @ApiOperation({ summary: '실패 주입 규칙 조회' })
  getFailureRules() {
    return this.failureInjectionService.getRules();
  }

  @Post('failure-rules')
  @ApiOperation({ summary: '실패 주입 규칙 설정/해제' })
  setFailureRule(@Body() dto: SetFailureRuleDto) {
    this.failureInjectionService.setRule(`EVENT:${dto.eventType}`, dto.failCount);
    return this.failureInjectionService.getRules();
  }
}
