import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class SetFailurePointDto {
  @ApiProperty({ example: 'SAGA:SHIPMENT_REQUEST' })
  @IsString()
  @MaxLength(128)
  key!: string;

  @ApiProperty({ example: 1, minimum: 0 })
  @IsInt()
  @Min(0)
  failCount!: number;
}
