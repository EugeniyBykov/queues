import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { DeliveryService } from './delivery.service';
import { DeliveryFactory } from './delivery.factory';
import { DeliveryChannelHandler } from './delivery.interface';
import { WebhookChannel } from './channels/webhook.channel';
import { EmailChannel } from './channels/email.channel';
import { InternalServiceChannel } from './channels/internal-service.channel';

const CHANNELS_TOKEN = 'DELIVERY_CHANNELS';

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [
    WebhookChannel,
    EmailChannel,
    InternalServiceChannel,
    {
      provide: CHANNELS_TOKEN,
      useFactory: (
        w: WebhookChannel,
        e: EmailChannel,
        i: InternalServiceChannel,
      ) => [w, e, i],
      inject: [WebhookChannel, EmailChannel, InternalServiceChannel],
    },
    {
      provide: DeliveryFactory,
      useFactory: (channels: DeliveryChannelHandler[]) =>
        new DeliveryFactory(channels),
      inject: [CHANNELS_TOKEN],
    },
    DeliveryService,
  ],
  exports: [DeliveryService, DeliveryFactory],
})
export class DeliveryModule {}
