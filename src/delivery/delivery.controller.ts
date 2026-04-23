import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { QueuesService } from '../queues/queues.service';

@ApiTags('deliveries')
@Controller('deliveries')
export class DeliveryController {
  constructor(private readonly queues: QueuesService) {}

  @Post()
  @ApiOperation({ summary: 'Enqueue a delivery job' })
  async create(@Body() body: CreateDeliveryDto) {
    const job = await this.queues.enqueueDelivery(body);
    return { jobId: job.id };
  }
}
