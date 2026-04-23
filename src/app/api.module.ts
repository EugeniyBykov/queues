import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from '../config/configuration';
import { validate } from '../config/config.validation';
import { DeliveryModule } from '../delivery/delivery.module';
import { DeliveryController } from '../delivery/delivery.controller';
import { QueuesModule } from '../queues/queues.module';
import { DeadLetterModule } from '../dead-letter/dead-letter.module';
import { AdminModule } from '../admin/admin.module';
import { LoggerModule } from '../logger/logger.module';
import { DeadLetterRecord } from '../dead-letter/dead-letter.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate }),
    LoggerModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        connection: {
          host: c.get<string>('redis.host'),
          port: c.get<number>('redis.port'),
        },
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        type: 'postgres',
        host: c.get<string>('database.host'),
        port: c.get<number>('database.port'),
        username: c.get<string>('database.user'),
        password: c.get<string>('database.password'),
        database: c.get<string>('database.name'),
        entities: [DeadLetterRecord],
        synchronize: c.get<string>('app.nodeEnv') !== 'production',
      }),
    }),
    DeliveryModule,
    QueuesModule,
    DeadLetterModule,
    AdminModule,
  ],
  controllers: [DeliveryController],
})
export class ApiModule {}
