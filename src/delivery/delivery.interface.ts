export type DeliveryChannel = 'webhook' | 'internal-service' | 'email';

export interface DeliveryPayload {
  id: string;
  channel: DeliveryChannel;
  target: string;
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

export interface DeliveryChannelHandler {
  canHandle(channel: DeliveryChannel): boolean;
  deliver(payload: DeliveryPayload): Promise<DeliveryResult>;
}

export interface DeadLetterPayload {
  originalJobId: string;
  payload: DeliveryPayload;
  reason: string;
  attemptsMade: number;
  failedAt: string;
}
