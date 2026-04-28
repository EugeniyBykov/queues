import { Job } from 'bullmq';
import { DeadLetterPayload } from '../delivery/delivery.interface';
import { DeadLetterNotifier } from '../notifications/notifier.interface';
import { DeadLetterProcessor } from './dead-letter.processor';
import { DeadLetterRepository } from './dead-letter.repository';

describe('DeadLetterProcessor', () => {
  const dl: DeadLetterPayload = {
    originalJobId: 'j1',
    payload: {
      id: 'm1',
      channel: 'webhook',
      target: 'http://t',
      body: 'b',
    },
    reason: 'boom',
    attemptsMade: 5,
    failedAt: '2026-04-24T00:00:00Z',
  };

  let repo: jest.Mocked<DeadLetterRepository>;
  let notifier: jest.Mocked<DeadLetterNotifier>;
  let processor: DeadLetterProcessor;

  beforeEach(() => {
    repo = {
      save: jest.fn().mockResolvedValue({
        id: 'r1',
        channel: 'webhook',
      }),
    } as unknown as jest.Mocked<DeadLetterRepository>;
    notifier = {
      notify: jest.fn().mockResolvedValue(undefined),
    };
    processor = new DeadLetterProcessor(repo, notifier);
  });

  it('saves a record with status=pending and notifies', async () => {
    const result = await processor.process({
      data: dl,
      id: 'x1',
    } as Job<DeadLetterPayload>);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        originalJobId: 'j1',
        reason: 'boom',
        channel: 'webhook',
        attemptsMade: 5,
        status: 'pending',
        failedAt: expect.any(Date),
      }),
    );
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1', channel: 'webhook' }),
    );
    expect(result).toEqual({ recordId: 'r1' });
  });

  it('swallows notifier errors (DB save still considered successful)', async () => {
    notifier.notify.mockRejectedValue(new Error('sentry down'));
    const result = await processor.process({
      data: dl,
      id: 'x1',
    } as Job<DeadLetterPayload>);
    expect(result).toEqual({ recordId: 'r1' });
  });

  it('rethrows if repo.save fails', async () => {
    repo.save.mockRejectedValue(new Error('db down'));
    await expect(
      processor.process({ data: dl, id: 'x1' } as Job<DeadLetterPayload>),
    ).rejects.toThrow('db down');
    expect(notifier.notify).not.toHaveBeenCalled();
  });
});
