import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrderStatus } from '../order-status.enum';

export class ForceOrderStatusDto {
  @ApiProperty({ enum: OrderStatus, example: OrderStatus.FAILED })
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @ApiPropertyOptional({ example: '운영자 수동 복구' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ example: 'admin-user' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  actor?: string;
}
