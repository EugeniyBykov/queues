import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { DeliveryChannel, DeliveryPayload } from '../delivery.interface';
import { HttpChannelBase } from './http-channel.base';

@Injectable()
export class InternalServiceChannel extends HttpChannelBase {
  protected readonly channel: DeliveryChannel = 'internal-service';

  constructor(http: HttpService, config: ConfigService) {
    super(http, config);
  }

  protected endpoint(): string {
    return this.config.get<string>('delivery.internalServiceUrl')!;
  }

  protected buildBody(payload: DeliveryPayload) {
    return {
      target: payload.target,
      id: payload.id,
      body: payload.body,
      subject: payload.subject,
      metadata: payload.metadata,
    };
  }
}
