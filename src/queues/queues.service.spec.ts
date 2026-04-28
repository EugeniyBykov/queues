import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { QueuesService } from './queues.service';
import { JOB_NAMES } from './constants';
import {
  DeliveryPayload,
  DeadLetterPayload,
} from '../delivery/delivery.interface';

describe('QueuesService', () => {
  let delivery: jest.Mocked<Queue>;
  let deadLetter: jest.Mocked<Queue>;
  let config: ConfigService;
  let service: QueuesService;

  beforeEach(() => {
    delivery = {
      add: jest.fn().mockResolvedValue({ id: 'd1' }),
    } as unknown as jest.Mocked<Queue>;
    deadLetter = {
      add: jest.fn().mockResolvedValue({ id: 'x1' }),
    } as unknown as jest.Mocked<Queue>;
    config = {
      get: jest.fn((k: string) => (k === 'delivery.maxAttempts' ? 5 : 1000)),
    } as unknown as ConfigService;
    service = new QueuesService(delivery, deadLetter, config);
  });

  const payload: DeliveryPayload = {
    id: 'm1',
    channel: 'webhook',
    target: 'http://t',
    body: 'b',
  };

  it('enqueueDelivery adds a "deliver" job with attempts+backoff from config', async () => {
    await service.enqueueDelivery(payload);
    expect(delivery.add).toHaveBeenCalledWith(
      JOB_NAMES.DELIVER,
      payload,
      expect.objectContaining({
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
      }),
    );
  });

  it('enqueueRetry adds a "retry" job to the delivery queue', async () => {
    await service.enqueueRetry(payload);
    expect(delivery.add).toHaveBeenCalledWith(
      JOB_NAMES.RETRY,
      payload,
      expect.any(Object),
    );
  });

  it('enqueueDeadLetter adds a "dead_letter" job to the dead-letter queue', async () => {
    const dl: DeadLetterPayload = {
      originalJobId: 'j1',
      payload,
      reason: 'boom',
      attemptsMade: 5,
      failedAt: new Date().toISOString(),
    };
    await service.enqueueDeadLetter(dl);
    expect(deadLetter.add).toHaveBeenCalledWith(
      JOB_NAMES.DEAD_LETTER,
      dl,
      expect.objectContaining({ removeOnComplete: true }),
    );
  });
});
