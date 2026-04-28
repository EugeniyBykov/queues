import { Module } from '@nestjs/common';
import { DEAD_LETTER_NOTIFIER } from './notifier.interface';
import { SentryNotifier } from './sentry.notifier';

@Module({
  providers: [
    SentryNotifier,
    { provide: DEAD_LETTER_NOTIFIER, useExisting: SentryNotifier },
  ],
  exports: [DEAD_LETTER_NOTIFIER],
})
export class NotificationsModule {}
