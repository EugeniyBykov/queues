import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { PermanentDeliveryError } from '../errors/permanent-delivery.error';
import { WebhookChannel } from './webhook.channel';

const response = (status: number): AxiosResponse =>
  ({
    status,
    data: {},
    headers: {},
    config: {} as any,
    statusText: '',
  }) as AxiosResponse;

const axiosError = (status: number): AxiosError =>
  Object.assign(new AxiosError('http error'), {
    response: { status } as any,
    isAxiosError: true,
  });

describe('WebhookChannel', () => {
  let http: { post: jest.Mock };
  let config: { get: jest.Mock };
  let channel: WebhookChannel;

  beforeEach(() => {
    http = { post: jest.fn() };
    config = { get: jest.fn().mockReturnValue(10000) };
    channel = new WebhookChannel(
      http as unknown as HttpService,
      config as unknown as ConfigService,
    );
  });

  it('canHandle returns true for webhook only', () => {
    expect(channel.canHandle('webhook')).toBe(true);
    expect(channel.canHandle('email')).toBe(false);
  });

  it('POSTs with expected body and returns success on 2xx', async () => {
    http.post.mockReturnValue(of(response(200)));
    const result = await channel.deliver('http://target/webhook', {
      id: 'm1',
      body: 'hi',
      subject: 's',
      metadata: { a: 1 },
    });
    expect(http.post).toHaveBeenCalledWith(
      'http://target/webhook',
      { id: 'm1', body: 'hi', subject: 's', metadata: { a: 1 } },
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(result.success).toBe(true);
  });

  it('throws PermanentDeliveryError on 4xx', async () => {
    http.post.mockReturnValue(throwError(() => axiosError(404)));
    await expect(
      channel.deliver('http://t', { id: 'm1', body: 'b' }),
    ).rejects.toBeInstanceOf(PermanentDeliveryError);
  });

  it('throws plain Error on 5xx (retryable)', async () => {
    http.post.mockReturnValue(throwError(() => axiosError(500)));
    await expect(
      channel.deliver('http://t', { id: 'm1', body: 'b' }),
    ).rejects.toThrow();
    await expect(
      channel.deliver('http://t', { id: 'm1', body: 'b' }),
    ).rejects.not.toBeInstanceOf(PermanentDeliveryError);
  });

  it('throws plain Error on timeout / network error', async () => {
    http.post.mockReturnValue(
      throwError(() =>
        Object.assign(new AxiosError('timeout'), { code: 'ECONNABORTED' }),
      ),
    );
    await expect(
      channel.deliver('http://t', { id: 'm1', body: 'b' }),
    ).rejects.not.toBeInstanceOf(PermanentDeliveryError);
  });
});
