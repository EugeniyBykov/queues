import { DeliveryFactory } from './delivery.factory';
import { DeliveryService } from './delivery.service';
import { DeliveryPayload } from './delivery.interface';

describe('DeliveryService', () => {
  const payload: DeliveryPayload = {
    id: 'm1',
    channel: 'webhook',
    target: 'http://t',
    body: 'b',
  };

  it('routes the payload to the matching handler', async () => {
    const webhook = {
      canHandle: (c: string) => c === 'webhook',
      deliver: jest.fn().mockResolvedValue({
        success: true,
        channel: 'webhook',
        target: 'http://t',
      }),
    };
    const email = {
      canHandle: (c: string) => c === 'email',
      deliver: jest.fn(),
    };
    const service = new DeliveryService(new DeliveryFactory([webhook, email]));
    const result = await service.deliver(payload);
    expect(result.success).toBe(true);
    expect(webhook.deliver).toHaveBeenCalledWith(payload);
    expect(email.deliver).not.toHaveBeenCalled();
  });

  it('propagates handler errors', async () => {
    const failing = {
      canHandle: () => true,
      deliver: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const service = new DeliveryService(new DeliveryFactory([failing]));
    await expect(service.deliver(payload)).rejects.toThrow('boom');
  });
});
