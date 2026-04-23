import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues/constants';
import { DeadLetterPayload } from '../delivery/delivery.interface';
import { DeadLetterRepository } from './dead-letter.repository';

@Processor(QUEUES.DEAD_LETTER)
export class DeadLetterProcessor extends WorkerHost {
  private readonly logger = new Logger(DeadLetterProcessor.name);

  constructor(private readonly repo: DeadLetterRepository) {
    super();
  }

  async process(job: Job<DeadLetterPayload>): Promise<{ recordId: string }> {
    const record = await this.repo.save({
      originalJobId: job.data.originalJobId,
      payload: job.data.payload,
      channels: job.data.channels,
      reason: job.data.reason,
      attemptsMade: job.data.attemptsMade,
      failedAt: new Date(job.data.failedAt),
      resubmittedAt: null,
      status: 'pending',
    });
    this.logger.log(
      `dead-letter persisted id=${record.id} original=${job.data.originalJobId}`,
    );
    return { recordId: record.id };
  }
}
