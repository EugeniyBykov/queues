import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { PermanentDeliveryError } from '../errors/permanent-delivery.error';
import { EmailChannel } from './email.channel';

const response = (status: number): AxiosResponse =>
  ({
    status,
    data: {},
    headers: {},
    config: {} as any,
    statusText: '',
  }) as AxiosResponse;

describe('EmailChannel', () => {
  let http: { post: jest.Mock };
  let config: { get: jest.Mock };
  let channel: EmailChannel;

  beforeEach(() => {
    http = { post: jest.fn() };
    config = {
      get: jest.fn((key: string) =>
        key === 'delivery.emailServiceUrl' ? 'http://mail-svc/send' : 10000,
      ),
    };
    channel = new EmailChannel(
      http as unknown as HttpService,
      config as unknown as ConfigService,
    );
  });

  it('canHandle returns true for email', () => {
    expect(channel.canHandle('email')).toBe(true);
  });

  it('POSTs to configured URL with { to: target } body', async () => {
    http.post.mockReturnValue(of(response(202)));
    await channel.deliver('alice@example.com', {
      id: 'm1',
      body: 'hi',
      subject: 'hello',
    });
    expect(http.post).toHaveBeenCalledWith(
      'http://mail-svc/send',
      {
        to: 'alice@example.com',
        id: 'm1',
        body: 'hi',
        subject: 'hello',
        metadata: undefined,
      },
      expect.objectContaining({ timeout: 10000 }),
    );
  });

  it('throws PermanentDeliveryError on 4xx', async () => {
    http.post.mockReturnValue(
      throwError(() =>
        Object.assign(new AxiosError('bad'), {
          response: { status: 400 } as any,
        }),
      ),
    );
    await expect(
      channel.deliver('alice@example.com', { id: 'm1', body: 'b' }),
    ).rejects.toBeInstanceOf(PermanentDeliveryError);
  });
});
