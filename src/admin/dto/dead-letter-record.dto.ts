import { ApiProperty } from '@nestjs/swagger';

export class DeadLetterRecordDto {
  @ApiProperty() id: string;
  @ApiProperty() originalJobId: string;
  @ApiProperty() reason: string;
  @ApiProperty() channel: string;
  @ApiProperty() attemptsMade: number;
  @ApiProperty() failedAt: Date;
  @ApiProperty({ required: false, nullable: true }) resubmittedAt: Date | null;
  @ApiProperty() status: 'pending' | 'resubmitted';
  @ApiProperty() createdAt: Date;
  @ApiProperty() payload: unknown;
}
