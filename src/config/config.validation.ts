import { plainToInstance } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  validateSync,
} from 'class-validator';

// Required fields have no safe default in configuration.ts and must be set
// explicitly (DB credentials, channel URLs). Optional fields have sensible
// protocol/operational defaults.
class EnvVariables {
  @IsOptional()
  @IsString()
  NODE_ENV?: string;

  @IsOptional()
  @IsNumber()
  PORT?: number;

  @IsString()
  @IsNotEmpty()
  DB_HOST: string;

  @IsOptional()
  @IsNumber()
  DB_PORT?: number;

  @IsString()
  @IsNotEmpty()
  DB_USER: string;

  @IsString()
  @IsNotEmpty()
  DB_PASSWORD: string;

  @IsString()
  @IsNotEmpty()
  DB_NAME: string;

  @IsString()
  @IsNotEmpty()
  REDIS_HOST: string;

  @IsOptional()
  @IsNumber()
  REDIS_PORT?: number;

  @IsOptional()
  @IsString()
  POSTGRES_USER?: string;

  @IsOptional()
  @IsString()
  POSTGRES_PASSWORD?: string;

  @IsOptional()
  @IsString()
  POSTGRES_DB?: string;

  @IsString()
  @IsNotEmpty()
  INTERNAL_SERVICE_URL: string;

  @IsString()
  @IsNotEmpty()
  EMAIL_SERVICE_URL: string;

  @IsOptional()
  @IsNumber()
  CHANNEL_TIMEOUT_MS?: number;

  @IsOptional()
  @IsNumber()
  DELIVERY_MAX_ATTEMPTS?: number;

  @IsOptional()
  @IsNumber()
  DELIVERY_BACKOFF_BASE_MS?: number;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validatedConfig;
}
