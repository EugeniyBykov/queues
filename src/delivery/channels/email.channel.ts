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
export class EmailChannel implements DeliveryChannelHandler {
  private readonly logger = new Logger(EmailChannel.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  canHandle(channel: DeliveryChannel): boolean {
    return channel === 'email';
  }

  async deliver(target: string, payload: BasePayload): Promise<DeliveryResult> {
    const url = this.config.get<string>('delivery.emailServiceUrl')!;
    const timeout =
      this.config.get<number>('delivery.channelTimeoutMs') ?? 10000;
    try {
      await firstValueFrom(
        this.http.post(
          url,
          {
            to: target,
            id: payload.id,
            body: payload.body,
            subject: payload.subject,
            metadata: payload.metadata,
          },
          { timeout },
        ),
      );
      this.logger.log(`email delivered id=${payload.id} to=${target}`);
      return { success: true, channel: 'email', target };
    } catch (err) {
      const status =
        err instanceof AxiosError ? err.response?.status : undefined;
      this.logger.error(
        `email failed id=${payload.id} to=${target} status=${status ?? 'n/a'}`,
      );
      if (status && status >= 400 && status < 500) {
        throw new PermanentDeliveryError(
          `Email service returned ${status}`,
          status,
        );
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}
