import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { ForceOrderStatusDto } from './dto/force-order-status.dto';
import { ReprocessOrderDto } from './dto/reprocess-order.dto';
import { SetFailurePointDto } from './dto/set-failure-point.dto';
import { FailureInjectionService } from './failure-injection.service';
import { OrdersService } from './orders.service';
import { SagaOrchestratorService } from './saga-orchestrator.service';

@ApiTags('admin-orders')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly sagaOrchestratorService: SagaOrchestratorService,
    private readonly auditLogService: AuditLogService,
    private readonly failureInjectionService: FailureInjectionService,
  ) {}

  @Post(':id/reprocess')
  @ApiOperation({ summary: 'FAILED 주문 재처리' })
  async reprocessOrder(@Param('id') id: string, @Body() dto: ReprocessOrderDto) {
    return this.sagaOrchestratorService.reprocessFailedOrder(id, dto.actor ?? 'admin');
  }

  @Post(':id/force-status')
  @ApiOperation({ summary: '주문 상태 강제 변경(운영자)' })
  async forceStatus(@Param('id') id: string, @Body() dto: ForceOrderStatusDto) {
    return this.ordersService.forceStatus(
      id,
      dto.status,
      dto.actor ?? 'admin',
      dto.reason,
    );
  }

  @Get(':id/audit-logs')
  @ApiOperation({ summary: '주문 감사 로그 조회' })
  async getAuditLogs(@Param('id') id: string, @Query('limit') limit?: string) {
    const parsedLimit = Number(limit ?? 100);
    return this.auditLogService.findByOrderId(id, parsedLimit);
  }

  @Get('failure-points')
  @ApiOperation({ summary: '실패 주입 포인트 조회' })
  getFailurePoints() {
    return this.failureInjectionService.getRules();
  }

  @Post('failure-points')
  @ApiOperation({ summary: '실패 주입 포인트 설정/해제' })
  setFailurePoint(@Body() dto: SetFailurePointDto) {
    this.failureInjectionService.setRule(dto.key, dto.failCount);
    return this.failureInjectionService.getRules();
  }
}
