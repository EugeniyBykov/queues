import { ApiProperty } from '@nestjs/swagger';

export class JobStatusDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() data: unknown;
  @ApiProperty() attemptsMade: number;
  @ApiProperty() state: string;
  @ApiProperty({ required: false }) failedReason?: string;
  @ApiProperty() timestamp: number;
}
