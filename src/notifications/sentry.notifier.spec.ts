import * as Sentry from '@sentry/node';
import { DeadLetterRecord } from '../dead-letter/dead-letter.entity';
import { SentryNotifier } from './sentry.notifier';

jest.mock('@sentry/node', () => ({
  captureMessage: jest.fn(),
}));

const record = (
  overrides: Partial<DeadLetterRecord> = {},
): DeadLetterRecord => ({
  id: 'r1',
  originalJobId: 'j1',
  payload: { id: 'm1', channel: 'webhook', target: 'http://t', body: 'b' },
  channel: 'webhook',
  reason: 'boom',
  attemptsMade: 5,
  failedAt: new Date('2026-04-27T10:00:00Z'),
  resubmittedAt: null,
  status: 'pending',
  createdAt: new Date(),
  ...overrides,
});

describe('SentryNotifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('captures a message with reason, level=error, channel/job/attempts tags', async () => {
    const notifier = new SentryNotifier();
    await notifier.notify(record());

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'DLQ: boom',
      expect.objectContaining({
        level: 'error',
        tags: expect.objectContaining({
          channel: 'webhook',
          original_job_id: 'j1',
          attempts_made: '5',
        }),
        extra: expect.objectContaining({
          payloadId: 'm1',
          target: 'http://t',
          failedAt: '2026-04-27T10:00:00.000Z',
        }),
      }),
    );
  });
});
