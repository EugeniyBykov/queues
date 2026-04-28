import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeadLetterRecord } from './dead-letter.entity';
import { DeadLetterRepository } from './dead-letter.repository';
import { DeadLetterService } from './dead-letter.service';
import { QueuesModule } from '../queues/queues.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeadLetterRecord]),
    QueuesModule,
    NotificationsModule,
  ],
  providers: [DeadLetterService, DeadLetterRepository],
  exports: [
    DeadLetterService,
    DeadLetterRepository,
    TypeOrmModule,
    NotificationsModule,
  ],
})
export class DeadLetterModule {}
