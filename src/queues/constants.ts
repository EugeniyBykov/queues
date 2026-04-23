export const QUEUES = {
  DELIVERY: 'delivery',
  DEAD_LETTER: 'dead_letter',
} as const;

export const JOB_NAMES = {
  DELIVER: 'deliver',
  RETRY: 'retry',
  DEAD_LETTER: 'dead_letter',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
