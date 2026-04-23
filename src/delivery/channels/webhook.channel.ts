import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import {
  BasePayload,
  DeliveryChannel,
  DeliveryChannelHandler,
  DeliveryResult,
} from '../delivery.interface';
import { PermanentDeliveryError } from '../errors/permanent-delivery.error';

@Injectable()
export class WebhookChannel implements DeliveryChannelHandler {
  private readonly logger = new Logger(WebhookChannel.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  canHandle(channel: DeliveryChannel): boolean {
    return channel === 'webhook';
  }

  async deliver(target: string, payload: BasePayload): Promise<DeliveryResult> {
    const timeout =
      this.config.get<number>('delivery.channelTimeoutMs') ?? 10000;
    try {
      await firstValueFrom(
        this.http.post(
          target,
          {
            id: payload.id,
            body: payload.body,
            subject: payload.subject,
            metadata: payload.metadata,
          },
          { timeout },
        ),
      );
      this.logger.log(`webhook delivered id=${payload.id} target=${target}`);
      return { success: true, channel: 'webhook', target };
    } catch (err) {
      const status =
        err instanceof AxiosError ? err.response?.status : undefined;
      this.logger.error(
        `webhook failed id=${payload.id} target=${target} status=${status ?? 'n/a'}`,
      );
      if (status && status >= 400 && status < 500) {
        throw new PermanentDeliveryError(
          `Webhook ${target} returned ${status}`,
          status,
        );
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}
