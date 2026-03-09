import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class SetFailureRuleDto {
  @ApiProperty({ example: 'ORDER_STATUS_CHANGED' })
  @IsString()
  @MaxLength(128)
  eventType!: string;

  @ApiProperty({ example: 2, minimum: 0 })
  @IsInt()
  @Min(0)
  failCount!: number;
}
