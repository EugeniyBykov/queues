import {
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeadLetterRepository } from '../../dead-letter/dead-letter.repository';
import { QueuesService } from '../../queues/queues.service';
import { AdminGuard } from '../admin.guard';
import { DeadLetterRecordDto } from '../dto/dead-letter-record.dto';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { ResubmitResponseDto } from '../dto/resubmit-response.dto';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin/dead-letter')
export class DeadLetterAdminController {
  constructor(
    private readonly repo: DeadLetterRepository,
    private readonly queues: QueuesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List dead-letter records' })
  async list(
    @Query() q: PaginationQueryDto,
  ): Promise<{ items: DeadLetterRecordDto[]; total: number }> {
    return this.repo.findPaginated(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single dead-letter record' })
  async getOne(@Param('id') id: string): Promise<DeadLetterRecordDto> {
    const rec = await this.repo.findById(id);
    if (!rec) throw new NotFoundException(`DLQ record ${id} not found`);
    return rec;
  }

  @Post(':id/resubmit')
  @ApiOperation({ summary: 'Resubmit dead-letter record to delivery queue' })
  async resubmit(@Param('id') id: string): Promise<ResubmitResponseDto> {
    const rec = await this.repo.findById(id);
    if (!rec) throw new NotFoundException(`DLQ record ${id} not found`);
    if (rec.status === 'resubmitted') {
      throw new ConflictException(`DLQ record ${id} already resubmitted`);
    }
    const job = await this.queues.enqueueRetry(rec.payload);
    await this.repo.markResubmitted(id);
    return { jobId: String(job.id), status: 'resubmitted' };
  }
}
