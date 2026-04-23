import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { of } from 'rxjs';
import { InternalServiceChannel } from './internal-service.channel';

const response = (status: number): AxiosResponse =>
  ({
    status,
    data: {},
    headers: {},
    config: {} as any,
    statusText: '',
  }) as AxiosResponse;

describe('InternalServiceChannel', () => {
  let http: { post: jest.Mock };
  let config: { get: jest.Mock };
  let channel: InternalServiceChannel;

  beforeEach(() => {
    http = { post: jest.fn() };
    config = {
      get: jest.fn((key: string) =>
        key === 'delivery.internalServiceUrl' ? 'http://internal/api' : 10000,
      ),
    };
    channel = new InternalServiceChannel(
      http as unknown as HttpService,
      config as unknown as ConfigService,
    );
  });

  it('canHandle returns true for internal-service', () => {
    expect(channel.canHandle('internal-service')).toBe(true);
  });

  it('POSTs to configured URL with target + payload in body', async () => {
    http.post.mockReturnValue(of(response(200)));
    await channel.deliver('notifications', { id: 'm1', body: 'hi' });
    expect(http.post).toHaveBeenCalledWith(
      'http://internal/api',
      {
        target: 'notifications',
        id: 'm1',
        body: 'hi',
        subject: undefined,
        metadata: undefined,
      },
      expect.objectContaining({ timeout: 10000 }),
    );
  });
});
