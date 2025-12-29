import type { Events } from '../events'
import type { WebhookEventType } from './events'

export { WEBHOOK_EVENT_TYPES, eventTypesList } from './events'

export type WebhookDelivery = Record<string, unknown>
export type WebhookDeliveryParams = {
  webhookId: string
  eventType: Events
  status: 'success' | 'failed'
  responseStatus?: number
  responseBody?: string
  errorMessage?: string
  nextRetryAt?: Date
}

export type CreateWebhookParams = {
  organizationId: string
  name: string
  url: string
  isActive: boolean
  eventTypes: WebhookEventType[]
}

export type UpdateWebhookParams = {
  // webhook: Webhook
  id: string
  name?: string
  url?: string
  isActive?: boolean
  eventTypes?: WebhookEventType[]
}

export type WebhookPayload = { eventType: string; payload: unknown }

export interface SendSignedWebhookParams {
  url: string
  secret: string
  payload: WebhookPayload
  additionalHeaders?: Record<string, string>
}

export interface WebhookSendResponse {
  success: boolean
  statusCode: number
  responseBody?: string
  error?: Error
}

export interface WebhookSendOptions {
  url: string
  payload: WebhookPayload | Record<string, unknown>
  headers?: Record<string, string>
}

export interface WebhookSendResponse {
  success: boolean
  statusCode: number
  responseBody?: string
  error?: Error
}

export interface WebhookTestResponse {
  success: boolean
  statusCode: number
  message: string
}
