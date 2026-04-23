import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { QUEUES, JOB_NAMES } from './constants';
import {
  DeadLetterPayload,
  DeliveryPayload,
} from '../delivery/delivery.interface';

@Injectable()
export class QueuesService {
  constructor(
    @InjectQueue(QUEUES.DELIVERY) private readonly deliveryQueue: Queue,
    @InjectQueue(QUEUES.DEAD_LETTER) private readonly deadLetterQueue: Queue,
    private readonly config: ConfigService,
  ) {}

  enqueueDelivery(payload: DeliveryPayload) {
    return this.deliveryQueue.add(
      JOB_NAMES.DELIVER,
      payload,
      this.deliveryOptions(),
    );
  }

  enqueueRetry(payload: DeliveryPayload) {
    return this.deliveryQueue.add(
      JOB_NAMES.RETRY,
      payload,
      this.deliveryOptions(),
    );
  }

  enqueueDeadLetter(payload: DeadLetterPayload) {
    return this.deadLetterQueue.add(JOB_NAMES.DEAD_LETTER, payload);
  }

  getDeliveryQueue(): Queue {
    return this.deliveryQueue;
  }

  getDeadLetterQueue(): Queue {
    return this.deadLetterQueue;
  }

  private deliveryOptions() {
    return {
      attempts: this.config.get<number>('delivery.maxAttempts') ?? 5,
      backoff: {
        type: 'exponential' as const,
        delay: this.config.get<number>('delivery.backoffBaseMs') ?? 1000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    };
  }
}
