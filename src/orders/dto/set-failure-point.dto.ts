import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class SetFailurePointDto {
  @ApiProperty({ example: 'SAGA:SHIPMENT_REQUEST' })
  @IsString()
  @MaxLength(128)
  key!: string;

  @ApiProperty({ example: 1, minimum: 0 })
  @IsInt()
  @Min(0)
  failCount!: number;

  @ApiPropertyOptional({
    description: '규칙 만료 시간(ms). 미지정 시 수동 해제 전까지 유지',
    example: 60000,
  })
  @IsOptional()
  @IsInt()
  @Min(1000)
  ttlMs?: number;
}
