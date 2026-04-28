import { Job, UnrecoverableError } from 'bullmq';
import { DeliveryPayload } from '../delivery/delivery.interface';
import { PermanentDeliveryError } from '../delivery/errors/permanent-delivery.error';
import { DeliveryService } from '../delivery/delivery.service';
import { DeadLetterService } from '../dead-letter/dead-letter.service';
import { DeliveryProcessor } from './delivery.processor';

const payload: DeliveryPayload = {
  id: 'm1',
  channel: 'webhook',
  target: 'http://t',
  body: 'b',
};

const makeJob = (
  attemptsMade: number,
  attempts: number,
): Job<DeliveryPayload> =>
  ({
    id: 'j1',
    data: payload,
    attemptsMade,
    opts: { attempts },
  }) as unknown as Job<DeliveryPayload>;

describe('DeliveryProcessor', () => {
  let delivery: jest.Mocked<DeliveryService>;
  let deadLetter: jest.Mocked<DeadLetterService>;
  let processor: DeliveryProcessor;

  beforeEach(() => {
    delivery = {
      deliver: jest.fn(),
    } as unknown as jest.Mocked<DeliveryService>;
    deadLetter = {
      publish: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeadLetterService>;
    processor = new DeliveryProcessor(delivery, deadLetter);
  });

  it('returns the delivery result on success', async () => {
    delivery.deliver.mockResolvedValue({
      success: true,
      channel: 'webhook',
      target: 'http://t',
    });
    const result = await processor.process(makeJob(0, 5));
    expect(result.success).toBe(true);
    expect(deadLetter.publish).not.toHaveBeenCalled();
  });

  it('rethrows (no DLQ) on non-final retryable failure', async () => {
    delivery.deliver.mockRejectedValue(new Error('5xx'));
    await expect(processor.process(makeJob(2, 5))).rejects.toThrow('5xx');
    expect(deadLetter.publish).not.toHaveBeenCalled();
  });

  it('publishes to DLQ and rethrows on final attempt', async () => {
    delivery.deliver.mockRejectedValue(new Error('5xx'));
    await expect(processor.process(makeJob(4, 5))).rejects.toThrow('5xx');
    expect(deadLetter.publish).toHaveBeenCalledTimes(1);
  });

  it('publishes to DLQ immediately on PermanentDeliveryError (regardless of attempt)', async () => {
    delivery.deliver.mockRejectedValue(new PermanentDeliveryError('400', 400));
    await expect(processor.process(makeJob(0, 5))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(deadLetter.publish).toHaveBeenCalledTimes(1);
  });
});
