import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class ReprocessDlqBatchDto {
  @ApiPropertyOptional({
    description: '재처리할 DLQ 이벤트 ID 목록 (미지정 시 전체 대상)',
    example: ['uuid-1', 'uuid-2'],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayMaxSize(100)
  ids?: string[];

  @ApiPropertyOptional({
    description: 'eventType 기준 필터',
    example: 'ORDER_CREATED',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  eventType?: string;
}
