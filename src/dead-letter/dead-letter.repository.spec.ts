import { Repository } from 'typeorm';
import { DeadLetterRecord } from './dead-letter.entity';
import { DeadLetterRepository } from './dead-letter.repository';

describe('DeadLetterRepository', () => {
  let typeOrmRepo: jest.Mocked<Repository<DeadLetterRecord>>;
  let repo: DeadLetterRepository;

  beforeEach(() => {
    typeOrmRepo = {
      save: jest.fn(),
      findOneBy: jest.fn(),
      findAndCount: jest.fn(),
      update: jest.fn(),
      create: jest.fn((x) => x as DeadLetterRecord),
    } as unknown as jest.Mocked<Repository<DeadLetterRecord>>;
    repo = new DeadLetterRepository(typeOrmRepo);
  });

  it('save persists a new record', async () => {
    const record = { originalJobId: 'j1' } as DeadLetterRecord;
    typeOrmRepo.save.mockResolvedValue({
      ...record,
      id: 'r1',
    });
    const result = await repo.save(record);
    expect(result.id).toBe('r1');
    expect(typeOrmRepo.save).toHaveBeenCalledWith(record);
  });

  it('findById returns record or null', async () => {
    typeOrmRepo.findOneBy.mockResolvedValue(null);
    expect(await repo.findById('missing')).toBeNull();
  });

  it('findPaginated filters by status and applies limit/offset', async () => {
    typeOrmRepo.findAndCount.mockResolvedValue([[], 0]);
    await repo.findPaginated({ status: 'pending', limit: 10, offset: 20 });
    expect(typeOrmRepo.findAndCount).toHaveBeenCalledWith({
      where: { status: 'pending' },
      take: 10,
      skip: 20,
      order: { createdAt: 'DESC' },
    });
  });

  it('markResubmitted updates status + resubmittedAt', async () => {
    typeOrmRepo.update.mockResolvedValue({ affected: 1 } as any);
    await repo.markResubmitted('r1');
    expect(typeOrmRepo.update).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'resubmitted' }),
    );
  });
});
