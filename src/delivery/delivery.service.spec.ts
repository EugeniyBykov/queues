import { DeliveryFactory } from './delivery.factory';
import { DeliveryService } from './delivery.service';
import { DeliveryChannelHandler, DeliveryPayload } from './delivery.interface';

describe('DeliveryService', () => {
  const payload: DeliveryPayload = {
    id: 'm1',
    body: 'b',
    deliveries: [
      { channel: 'webhook', target: 'http://t' },
      { channel: 'email', target: 'x@y' },
    ],
  };

  it('dispatches each delivery to its handler and aggregates results', async () => {
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
      deliver: jest
        .fn()
        .mockResolvedValue({ success: true, channel: 'email', target: 'x@y' }),
    };
    const service = new DeliveryService(new DeliveryFactory([webhook, email]));
    const results = await service.deliver(payload);
    expect(results).toHaveLength(2);
    expect(webhook.deliver).toHaveBeenCalledWith('http://t', {
      id: 'm1',
      body: 'b',
      subject: undefined,
      metadata: undefined,
    });
    expect(email.deliver).toHaveBeenCalled();
  });

  it('propagates the first error (stops at failing channel)', async () => {
    const failing = {
      canHandle: () => true,
      deliver: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const service = new DeliveryService(new DeliveryFactory([failing]));
    await expect(service.deliver(payload)).rejects.toThrow('boom');
  });
});
