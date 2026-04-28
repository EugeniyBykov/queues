import { Injectable } from '@nestjs/common';
import { DeliveryFactory } from './delivery.factory';
import { DeliveryPayload, DeliveryResult } from './delivery.interface';

@Injectable()
export class DeliveryService {
  constructor(private readonly deliveryFactory: DeliveryFactory) {}

  async deliver(payload: DeliveryPayload): Promise<DeliveryResult> {
    const handler = this.deliveryFactory.getHandler(payload.channel);
    return handler.deliver(payload);
  }
}
