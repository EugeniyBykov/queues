import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeadLetterRecord } from './dead-letter.entity';
import { DeadLetterRepository } from './dead-letter.repository';
import { DeadLetterService } from './dead-letter.service';
import { QueuesModule } from '../queues/queues.module';

@Module({
  imports: [TypeOrmModule.forFeature([DeadLetterRecord]), QueuesModule],
  providers: [DeadLetterService, DeadLetterRepository],
  exports: [DeadLetterService, DeadLetterRepository, TypeOrmModule],
})
export class DeadLetterModule {}
