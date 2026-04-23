import { ApiProperty } from '@nestjs/swagger';

export class QueueStatsDto {
  @ApiProperty() waiting: number;
  @ApiProperty() active: number;
  @ApiProperty() delayed: number;
  @ApiProperty() failed: number;
  @ApiProperty() completed: number;
  @ApiProperty({ type: [Object] }) recentJobs: unknown[];
}
