import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Job } from 'bullmq';
import { QUEUES } from '../queues/constants';
import { DeadLetterPayload } from '../delivery/delivery.interface';
import {
  DEAD_LETTER_NOTIFIER,
  type DeadLetterNotifier,
} from '../notifications/notifier.interface';
import { DeadLetterRecord } from './dead-letter.entity';
import { DeadLetterRepository } from './dead-letter.repository';

@Processor(QUEUES.DEAD_LETTER)
export class DeadLetterProcessor extends WorkerHost {
  private readonly logger = new Logger(DeadLetterProcessor.name);

  constructor(
    private readonly repo: DeadLetterRepository,
    @Inject(DEAD_LETTER_NOTIFIER)
    private readonly notifier: DeadLetterNotifier,
  ) {
    super();
  }

  async process(job: Job<DeadLetterPayload>): Promise<{ recordId: string }> {
    let record: DeadLetterRecord;
    try {
      record = await this.repo.save({
        originalJobId: job.data.originalJobId,
        payload: job.data.payload,
        channel: job.data.payload.channel,
        reason: job.data.reason,
        attemptsMade: job.data.attemptsMade,
        failedAt: new Date(job.data.failedAt),
        resubmittedAt: null,
        status: 'pending',
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: {
          kind: 'dlq_persist_failure',
          original_job_id: job.data.originalJobId,
        },
      });
      throw err;
    }

    this.logger.log(
      `dead-letter persisted id=${record.id} original=${job.data.originalJobId}`,
    );

    try {
      await this.notifier.notify(record);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `dead-letter notification failed id=${record.id}: ${message}`,
      );
    }

    return { recordId: record.id };
  }
}
