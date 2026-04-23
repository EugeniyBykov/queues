import { ApiProperty } from '@nestjs/swagger';

export class ResubmitResponseDto {
  @ApiProperty() jobId: string;
  @ApiProperty() status: 'resubmitted';
}
