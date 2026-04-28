import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import type { DeliveryChannel } from '../delivery.interface';

export class CreateDeliveryDto {
  @IsString()
  id: string;

  @IsEnum(['webhook', 'internal-service', 'email'])
  channel: DeliveryChannel;

  @IsString()
  target: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  body: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
