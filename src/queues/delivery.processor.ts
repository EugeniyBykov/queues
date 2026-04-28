import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from './constants';
import {
  DeliveryPayload,
  DeliveryResult,
} from '../delivery/delivery.interface';
import { DeliveryService } from '../delivery/delivery.service';
import { DeadLetterService } from '../dead-letter/dead-letter.service';
import { PermanentDeliveryError } from '../delivery/errors/permanent-delivery.error';

@Processor(QUEUES.DELIVERY)
export class DeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(DeliveryProcessor.name);

  constructor(
    private readonly delivery: DeliveryService,
    private readonly deadLetter: DeadLetterService,
  ) {
    super();
  }

  async process(job: Job<DeliveryPayload>): Promise<DeliveryResult> {
    try {
      return await this.delivery.deliver(job.data);
    } catch (err) {
      const maxAttempts = job.opts.attempts ?? 1;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
      const isPermanent = err instanceof PermanentDeliveryError;
      if (isPermanent || isFinalAttempt) {
        this.logger.error(
          `delivery terminal failure job=${job.id} permanent=${isPermanent} attemptsMade=${job.attemptsMade + 1}`,
        );
        await this.deadLetter.publish(job, err);
      }
      throw err;
    }
  }
}
