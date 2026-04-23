import { UnrecoverableError } from 'bullmq';

export class PermanentDeliveryError extends UnrecoverableError {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'PermanentDeliveryError';
  }
}
