import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QueuesService } from '../../queues/queues.service';
import { QueueAdminController } from './queue-admin.controller';

describe('QueueAdminController', () => {
  const makeQueue = (overrides: Partial<Queue> = {}): jest.Mocked<Queue> =>
    ({
      getWaitingCount: jest.fn().mockResolvedValue(1),
      getActiveCount: jest.fn().mockResolvedValue(2),
      getDelayedCount: jest.fn().mockResolvedValue(3),
      getFailedCount: jest.fn().mockResolvedValue(4),
      getCompletedCount: jest.fn().mockResolvedValue(5),
      getJobs: jest.fn().mockResolvedValue([{ id: 'j1', name: 'deliver' }]),
      getJob: jest.fn(),
      ...overrides,
    }) as unknown as jest.Mocked<Queue>;

  let delivery: jest.Mocked<Queue>;
  let deadLetter: jest.Mocked<Queue>;
  let queuesService: jest.Mocked<QueuesService>;
  let controller: QueueAdminController;

  beforeEach(() => {
    delivery = makeQueue();
    deadLetter = makeQueue();
    queuesService = {
      getDeliveryQueue: () => delivery,
      getDeadLetterQueue: () => deadLetter,
    } as unknown as jest.Mocked<QueuesService>;
    controller = new QueueAdminController(queuesService);
  });

  it('returns counts + recent jobs for a valid queue name', async () => {
    const stats = await controller.getQueue('delivery');
    expect(stats).toMatchObject({ waiting: 1, active: 2, completed: 5 });
    expect(stats.recentJobs).toHaveLength(1);
  });

  it('throws BadRequest for unknown queue name', async () => {
    await expect(controller.getQueue('nope' as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('getJob returns job state', async () => {
    (delivery.getJob as jest.Mock).mockResolvedValue({
      id: 'j1',
      name: 'deliver',
      data: {},
      attemptsMade: 0,
      failedReason: undefined,
      timestamp: 1,
      getState: jest.fn().mockResolvedValue('waiting'),
    });
    const result = await controller.getJob('delivery', 'j1');
    expect(result.state).toBe('waiting');
  });

  it('getJob throws NotFound when job missing', async () => {
    (delivery.getJob as jest.Mock).mockResolvedValue(undefined);
    await expect(
      controller.getJob('delivery', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
