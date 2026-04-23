import { Module } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { QueueAdminController } from './controllers/queue-admin.controller';
import { DeadLetterAdminController } from './controllers/dead-letter-admin.controller';
import { QueuesModule } from '../queues/queues.module';
import { DeadLetterModule } from '../dead-letter/dead-letter.module';

@Module({
  imports: [QueuesModule, DeadLetterModule],
  controllers: [QueueAdminController, DeadLetterAdminController],
  providers: [AdminGuard],
})
export class AdminModule {}
