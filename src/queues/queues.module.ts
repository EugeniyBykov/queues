import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from './constants';
import { QueuesService } from './queues.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUES.DELIVERY },
      { name: QUEUES.DEAD_LETTER },
    ),
  ],
  providers: [QueuesService],
  exports: [QueuesService, BullModule],
})
export class QueuesModule {}
