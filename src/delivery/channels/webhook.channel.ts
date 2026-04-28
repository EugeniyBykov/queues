import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { DeliveryChannel, DeliveryPayload } from '../delivery.interface';
import { HttpChannelBase } from './http-channel.base';

@Injectable()
export class WebhookChannel extends HttpChannelBase {
  protected readonly channel: DeliveryChannel = 'webhook';

  constructor(http: HttpService, config: ConfigService) {
    super(http, config);
  }

  protected endpoint(payload: DeliveryPayload): string {
    return payload.target;
  }

  protected buildBody(payload: DeliveryPayload) {
    return {
      id: payload.id,
      body: payload.body,
      subject: payload.subject,
      metadata: payload.metadata,
    };
  }
}
