import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  DeadLetterPayload,
  DeliveryPayload,
} from '../delivery/delivery.interface';
import { QueuesService } from '../queues/queues.service';

@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);

  constructor(private readonly queues: QueuesService) {}

  async publish(job: Job<DeliveryPayload>, error: unknown): Promise<void> {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    const payload: DeadLetterPayload = {
      originalJobId: String(job.id),
      payload: job.data,
      reason,
      attemptsMade: job.attemptsMade,
      failedAt: new Date().toISOString(),
    };
    this.logger.error(
      `dead-letter published job=${job.id} channel=${job.data.channel} reason="${reason}"`,
    );
    await this.queues.enqueueDeadLetter(payload);
  }
}
