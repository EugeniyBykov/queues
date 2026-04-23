export type DeliveryChannel = 'webhook' | 'internal-service' | 'email';

export interface DeliveryTarget {
  channel: DeliveryChannel;
  target: string;
}

export interface DeliveryPayload {
  id: string;
  deliveries: DeliveryTarget[];
  subject?: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface DeliveryResult {
  success: boolean;
  channel: DeliveryChannel;
  target: string;
  message?: string;
}

export type BasePayload = Omit<DeliveryPayload, 'deliveries'>;

export interface DeliveryChannelHandler {
  canHandle(channel: DeliveryChannel): boolean;
  deliver(target: string, payload: BasePayload): Promise<DeliveryResult>;
}

export interface DeadLetterPayload {
  originalJobId: string;
  payload: DeliveryPayload;
  reason: string;
  channels: DeliveryChannel[];
  attemptsMade: number;
  failedAt: string;
}
