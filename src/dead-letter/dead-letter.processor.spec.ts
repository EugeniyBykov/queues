import { Job } from 'bullmq';
import { DeadLetterPayload } from '../delivery/delivery.interface';
import { DeadLetterProcessor } from './dead-letter.processor';
import { DeadLetterRepository } from './dead-letter.repository';

describe('DeadLetterProcessor', () => {
  const dl: DeadLetterPayload = {
    originalJobId: 'j1',
    payload: {
      id: 'm1',
      body: 'b',
      deliveries: [{ channel: 'webhook', target: 'http://t' }],
    },
    reason: 'boom',
    channels: ['webhook'],
    attemptsMade: 5,
    failedAt: '2026-04-24T00:00:00Z',
  };

  it('saves a record with status=pending', async () => {
    const repo = {
      save: jest.fn().mockResolvedValue({ id: 'r1' }),
    } as unknown as jest.Mocked<DeadLetterRepository>;
    const processor = new DeadLetterProcessor(repo);
    const result = await processor.process({
      data: dl,
      id: 'x1',
    } as Job<DeadLetterPayload>);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        originalJobId: 'j1',
        reason: 'boom',
        channels: ['webhook'],
        attemptsMade: 5,
        status: 'pending',
        failedAt: expect.any(Date),
      }),
    );
    expect(result).toEqual({ recordId: 'r1' });
  });
});
