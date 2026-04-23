import { Injectable } from '@nestjs/common';
import { DeliveryChannel, DeliveryChannelHandler } from './delivery.interface';

@Injectable()
export class DeliveryFactory {
  constructor(private readonly handlers: DeliveryChannelHandler[]) {}

  getHandler(channel: DeliveryChannel): DeliveryChannelHandler {
    const handler = this.handlers.find((item) => item.canHandle(channel));

    if (!handler) {
      throw new Error(`Unsupported delivery channel: ${channel}`);
    }

    return handler;
  }
}
