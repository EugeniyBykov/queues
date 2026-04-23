import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeadLetterRecord, DeadLetterStatus } from './dead-letter.entity';

export interface FindPaginatedOptions {
  status?: DeadLetterStatus;
  limit: number;
  offset: number;
}

@Injectable()
export class DeadLetterRepository {
  constructor(
    @InjectRepository(DeadLetterRecord)
    private readonly repo: Repository<DeadLetterRecord>,
  ) {}

  save(record: Partial<DeadLetterRecord>): Promise<DeadLetterRecord> {
    return this.repo.save(record as DeadLetterRecord);
  }

  findById(id: string): Promise<DeadLetterRecord | null> {
    return this.repo.findOneBy({ id });
  }

  async findPaginated(
    options: FindPaginatedOptions,
  ): Promise<{ items: DeadLetterRecord[]; total: number }> {
    const where = options.status ? { status: options.status } : {};
    const [items, total] = await this.repo.findAndCount({
      where,
      take: options.limit,
      skip: options.offset,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async markResubmitted(id: string): Promise<void> {
    await this.repo.update(id, {
      status: 'resubmitted',
      resubmittedAt: new Date(),
    });
  }
}
