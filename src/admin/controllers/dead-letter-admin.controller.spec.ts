import { ConflictException, NotFoundException } from '@nestjs/common';
import { DeadLetterRecord } from '../../dead-letter/dead-letter.entity';
import { DeadLetterRepository } from '../../dead-letter/dead-letter.repository';
import { QueuesService } from '../../queues/queues.service';
import { DeadLetterAdminController } from './dead-letter-admin.controller';

const record = (
  overrides: Partial<DeadLetterRecord> = {},
): DeadLetterRecord => ({
  id: 'r1',
  originalJobId: 'j1',
  payload: { id: 'm1', body: 'b', deliveries: [] },
  channels: ['webhook'],
  reason: 'boom',
  attemptsMade: 5,
  failedAt: new Date(),
  resubmittedAt: null,
  status: 'pending',
  createdAt: new Date(),
  ...overrides,
});

describe('DeadLetterAdminController', () => {
  let repo: jest.Mocked<DeadLetterRepository>;
  let queues: jest.Mocked<QueuesService>;
  let controller: DeadLetterAdminController;

  beforeEach(() => {
    repo = {
      findPaginated: jest.fn(),
      findById: jest.fn(),
      markResubmitted: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeadLetterRepository>;
    queues = {
      enqueueRetry: jest.fn().mockResolvedValue({ id: 'newJob' }),
    } as unknown as jest.Mocked<QueuesService>;
    controller = new DeadLetterAdminController(repo, queues);
  });

  it('list returns paginated records', async () => {
    repo.findPaginated.mockResolvedValue({ items: [record()], total: 1 });
    const res = await controller.list({ limit: 25, offset: 0 });
    expect(res.items).toHaveLength(1);
    expect(res.total).toBe(1);
  });

  it('getOne 404s when missing', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(controller.getOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('resubmit enqueues retry + marks record resubmitted', async () => {
    repo.findById.mockResolvedValue(record());
    const res = await controller.resubmit('r1');
    expect(queues.enqueueRetry).toHaveBeenCalled();
    expect(repo.markResubmitted).toHaveBeenCalledWith('r1');
    expect(res).toEqual({ jobId: 'newJob', status: 'resubmitted' });
  });

  it('resubmit 409s when already resubmitted', async () => {
    repo.findById.mockResolvedValue(record({ status: 'resubmitted' }));
    await expect(controller.resubmit('r1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('resubmit 404s when record missing', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(controller.resubmit('r1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
