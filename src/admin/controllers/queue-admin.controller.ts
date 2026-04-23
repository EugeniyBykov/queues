import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import { QueuesService } from '../../queues/queues.service';
import { AdminGuard } from '../admin.guard';
import { QueueStatsDto } from '../dto/queue-stats.dto';
import { JobStatusDto } from '../dto/job-status.dto';

const KNOWN_QUEUES = ['delivery', 'dead_letter'] as const;
type KnownQueue = (typeof KNOWN_QUEUES)[number];

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin/queues')
export class QueueAdminController {
  constructor(private readonly queues: QueuesService) {}

  @Get(':name')
  @ApiOperation({ summary: 'Queue counts and recent jobs' })
  async getQueue(@Param('name') name: string): Promise<QueueStatsDto> {
    const q = this.resolveQueue(name);
    const [waiting, active, delayed, failed, completed, recentJobs] =
      await Promise.all([
        q.getWaitingCount(),
        q.getActiveCount(),
        q.getDelayedCount(),
        q.getFailedCount(),
        q.getCompletedCount(),
        q.getJobs(
          ['waiting', 'active', 'delayed', 'failed', 'completed'],
          0,
          19,
        ),
      ]);
    return {
      waiting,
      active,
      delayed,
      failed,
      completed,
      recentJobs: recentJobs.map((j) => ({
        id: j.id,
        name: j.name,
        attemptsMade: j.attemptsMade,
      })),
    };
  }

  @Get(':name/:jobId')
  @ApiOperation({ summary: 'Full job status' })
  async getJob(
    @Param('name') name: string,
    @Param('jobId') jobId: string,
  ): Promise<JobStatusDto> {
    const q = this.resolveQueue(name);
    const job = await q.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found in ${name}`);
    return {
      id: String(job.id),
      name: job.name,
      data: job.data,
      attemptsMade: job.attemptsMade,
      state: await job.getState(),
      failedReason: job.failedReason,
      timestamp: job.timestamp,
    };
  }

  private resolveQueue(name: string): Queue {
    if (!(KNOWN_QUEUES as readonly string[]).includes(name)) {
      throw new BadRequestException(
        `Unknown queue: ${name}. Valid: ${KNOWN_QUEUES.join(', ')}`,
      );
    }
    return (name as KnownQueue) === 'delivery'
      ? this.queues.getDeliveryQueue()
      : this.queues.getDeadLetterQueue();
  }
}
