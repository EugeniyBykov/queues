import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { DeadLetterRecord } from '../dead-letter/dead-letter.entity';
import { DeadLetterNotifier } from './notifier.interface';

@Injectable()
export class SentryNotifier implements DeadLetterNotifier {
  notify(record: DeadLetterRecord): Promise<void> {
    Sentry.captureMessage(`DLQ: ${record.reason}`, {
      level: 'error',
      tags: {
        kind: 'dlq_event',
        channel: record.channel,
        original_job_id: record.originalJobId,
        attempts_made: String(record.attemptsMade),
      },
      extra: {
        payloadId: record.payload.id,
        target: record.payload.target,
        failedAt: record.failedAt.toISOString(),
      },
    });
    return Promise.resolve();
  }
}
