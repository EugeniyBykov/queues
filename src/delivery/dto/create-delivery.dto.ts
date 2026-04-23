import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import type { DeliveryChannel } from '../delivery.interface';

class CreateDeliveryTargetDto {
  @IsEnum(['webhook', 'internal-service', 'email'])
  channel: DeliveryChannel;

  @IsString()
  target: string;
}

export class CreateDeliveryDto {
  @IsString()
  id: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateDeliveryTargetDto)
  deliveries: CreateDeliveryTargetDto[];

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  body: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
