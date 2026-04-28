import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import {
  DeliveryChannel,
  DeliveryChannelHandler,
  DeliveryPayload,
  DeliveryResult,
} from '../delivery.interface';
import { PermanentDeliveryError } from '../errors/permanent-delivery.error';

export abstract class HttpChannelBase implements DeliveryChannelHandler {
  protected abstract readonly channel: DeliveryChannel;
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    protected readonly http: HttpService,
    protected readonly config: ConfigService,
  ) {}

  canHandle(channel: DeliveryChannel): boolean {
    return channel === this.channel;
  }

  async deliver(payload: DeliveryPayload): Promise<DeliveryResult> {
    const url = this.endpoint(payload);
    const timeout =
      this.config.get<number>('delivery.channelTimeoutMs') ?? 10000;
    try {
      await firstValueFrom(
        this.http.post(url, this.buildBody(payload), { timeout }),
      );
      this.logger.log(
        `${this.channel} delivered id=${payload.id} target=${payload.target}`,
      );
      return { success: true, channel: this.channel, target: payload.target };
    } catch (err) {
      const status =
        err instanceof AxiosError ? err.response?.status : undefined;
      this.logger.error(
        `${this.channel} failed id=${payload.id} target=${payload.target} status=${status ?? 'n/a'}`,
      );
      if (status && status >= 400 && status < 500) {
        throw new PermanentDeliveryError(
          this.permanentErrorMessage(status, payload),
          status,
        );
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  protected abstract endpoint(payload: DeliveryPayload): string;
  protected abstract buildBody(payload: DeliveryPayload): unknown;

  protected permanentErrorMessage(
    status: number,
    payload: DeliveryPayload,
  ): string {
    return `${this.channel} delivery to ${payload.target} returned ${status}`;
  }
}
