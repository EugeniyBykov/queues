import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { AllExceptionsFilter } from './all-exceptions.filter';

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}));

const buildHost = (): {
  host: ArgumentsHost;
  res: { status: jest.Mock; json: jest.Mock };
} => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json };
  const req = { url: '/x', method: 'POST', route: { path: '/x' } };
  return {
    host: {
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => req,
      }),
    } as unknown as ArgumentsHost,
    res,
  };
};

describe('AllExceptionsFilter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes HttpException through without capturing to Sentry', () => {
    const filter = new AllExceptionsFilter();
    const { host, res } = buildHost();
    filter.catch(new BadRequestException('bad'), host);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('captures non-HttpException to Sentry and returns 500', () => {
    const filter = new AllExceptionsFilter();
    const { host, res } = buildHost();
    const err = new Error('boom');
    filter.catch(err, host);
    expect(Sentry.captureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        tags: expect.objectContaining({ method: 'POST' }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
