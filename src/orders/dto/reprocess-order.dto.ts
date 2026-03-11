import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReprocessOrderDto {
  @ApiPropertyOptional({ example: 'admin-user' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  actor?: string;
}
