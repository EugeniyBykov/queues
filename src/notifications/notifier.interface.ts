import { DeadLetterRecord } from '../dead-letter/dead-letter.entity';

export const DEAD_LETTER_NOTIFIER = 'DEAD_LETTER_NOTIFIER';

export interface DeadLetterNotifier {
  notify(record: DeadLetterRecord): Promise<void>;
}
