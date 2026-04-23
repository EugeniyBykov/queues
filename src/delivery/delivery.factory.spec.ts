import { DeliveryFactory } from './delivery.factory';
import { DeliveryChannelHandler } from './delivery.interface';

const makeHandler = (name: string): DeliveryChannelHandler => ({
  canHandle: (c) => c === name,
  deliver: jest.fn(),
});

describe('DeliveryFactory', () => {
  it('returns the handler matching the channel', () => {
    const webhook = makeHandler('webhook');
    const factory = new DeliveryFactory([webhook, makeHandler('email')]);
    expect(factory.getHandler('webhook')).toBe(webhook);
  });

  it('throws when no handler matches', () => {
    const factory = new DeliveryFactory([makeHandler('webhook')]);
    expect(() => factory.getHandler('email')).toThrow(
      /Unsupported delivery channel: email/,
    );
  });
});
