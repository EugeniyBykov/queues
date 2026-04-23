import { Injectable } from '@nestjs/common';
import { DeliveryFactory } from './delivery.factory';
import { DeliveryPayload, DeliveryResult } from './delivery.interface';

@Injectable()
export class DeliveryService {
  constructor(private readonly deliveryFactory: DeliveryFactory) {}

  async deliver(payload: DeliveryPayload): Promise<DeliveryResult[]> {
    const basePayload = {
      id: payload.id,
      subject: payload.subject,
      body: payload.body,
      metadata: payload.metadata,
    };

    const results: DeliveryResult[] = [];

    for (const delivery of payload.deliveries) {
      const handler = this.deliveryFactory.getHandler(delivery.channel);
      const result = await handler.deliver(delivery.target, basePayload);
      results.push(result);
    }

    return results;
  }
}
