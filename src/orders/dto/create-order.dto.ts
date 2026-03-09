import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOrderItemDto {
  @ApiProperty({ example: 'SKU-RED-SHIRT' })
  @IsString()
  @MaxLength(64)
  sku!: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  qty!: number;

  @ApiProperty({ example: 19900, minimum: 1 })
  @IsInt()
  @Min(1)
  price!: number;
}

export class CreateOrderDto {
  @ApiProperty({ example: 'customer-1234' })
  @IsString()
  @MaxLength(64)
  customerId!: string;

  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
