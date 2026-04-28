import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { DeliveryPayload } from '../delivery/delivery.interface';

export type DeadLetterStatus = 'pending' | 'resubmitted';

@Entity('dead_letter_records')
export class DeadLetterRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  originalJobId: string;

  @Column('jsonb')
  payload: DeliveryPayload;

  @Column('text')
  channel: string;

  @Column('text')
  reason: string;

  @Column('int')
  attemptsMade: number;

  @Column('timestamptz')
  failedAt: Date;

  @Column('timestamptz', { nullable: true })
  resubmittedAt: Date | null;

  @Column({
    type: 'enum',
    enum: ['pending', 'resubmitted'],
    default: 'pending',
  })
  status: DeadLetterStatus;

  @CreateDateColumn()
  createdAt: Date;
}
