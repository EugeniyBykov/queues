import { Job } from 'bullmq';
import { DeliveryPayload } from '../delivery/delivery.interface';
import { DeadLetterService } from './dead-letter.service';
import { QueuesService } from '../queues/queues.service';

describe('DeadLetterService', () => {
  const payload: DeliveryPayload = {
    id: 'm1',
    channel: 'webhook',
    target: 'http://t',
    body: 'b',
  };

  let queues: jest.Mocked<QueuesService>;
  let service: DeadLetterService;

  beforeEach(() => {
    queues = {
      enqueueDeadLetter: jest.fn().mockResolvedValue({ id: 'x1' }),
    } as unknown as jest.Mocked<QueuesService>;
    service = new DeadLetterService(queues);
  });

  it('publish builds a payload from the job+error and enqueues to DLQ', async () => {
    const job = {
      id: 'j1',
      data: payload,
      attemptsMade: 5,
    } as unknown as Job<DeliveryPayload>;
    await service.publish(job, new Error('boom'));
    expect(queues.enqueueDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        originalJobId: 'j1',
        payload,
        reason: 'boom',
        attemptsMade: 5,
      }),
    );
  });

  it('falls back to "Unknown error" when error is not an Error instance', async () => {
    const job = {
      id: 'j2',
      data: payload,
      attemptsMade: 1,
    } as unknown as Job<DeliveryPayload>;
    await service.publish(job, 'weird');
    expect(queues.enqueueDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Unknown error' }),
    );
  });
});
