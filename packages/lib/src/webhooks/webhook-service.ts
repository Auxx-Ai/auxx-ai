import { type Database, database, schema } from '@auxx/database'
import type { WebhookEntity as Webhook } from '@auxx/database/models'
import { createHmac, randomBytes } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { NotFoundError, UnprocessableEntityError } from '../errors'
import { type AuxxEvent, publisher } from '../events'
import { createScopedLogger } from '../logger'
import { Result, type TypedResult } from '../result'
import { WEBHOOK_EVENT_TYPES } from './events'
import type {
  CreateWebhookParams,
  SendSignedWebhookParams,
  UpdateWebhookParams,
  WebhookDelivery,
  WebhookDeliveryParams,
  WebhookPayload,
  WebhookSendOptions,
  WebhookSendResponse,
  WebhookTestResponse,
} from './types'

const logger = createScopedLogger('webhook-service')

export class WebhookService {
  private static instance: WebhookService
  private organizationId: string
  private db: Database

  constructor(organizationId: string, db: Database = database) {
    this.organizationId = organizationId
    this.db = db
  }

  async storeDelivery(params: WebhookDeliveryParams): Promise<TypedResult<WebhookDelivery, Error>> {
    let result: TypedResult<WebhookDelivery, Error>
    const [delivery] = await this.db
      .insert(schema.WebhookDelivery)
      .values({
        webhookId: params.webhookId,
        eventType: params.eventType,
        status: params.status,
        responseStatus: params.responseStatus!,
        responseBody: params.responseBody,
        errorMessage: params.errorMessage,
        nextRetryAt: params.nextRetryAt,
        updatedAt: new Date(),
      })
      .returning()
    if (!delivery) {
      result = Result.error(new Error('Failed to create webhook delivery'))
    }
    result = Result.ok(delivery)

    publisher.publishLater({
      type: 'webhook:delivery:created',
      data: { ...params, organizationId: this.organizationId },
    })
    return result
  }
  async processPayload(event: AuxxEvent): Promise<TypedResult<WebhookPayload, Error>> {
    try {
      return Result.ok({ eventType: event.type, payload: event.data })
    } catch (error) {
      return Result.error(error as Error)
    }
  }
  async sendSignedWebhook({
    url,
    secret,
    payload,
    additionalHeaders = {},
  }: SendSignedWebhookParams): Promise<TypedResult<WebhookSendResponse, Error>> {
    const signature = this.generateWebhookSignature(payload, secret)
    logger.info('Sending signed webhook', { url, payload, signature })
    const response = await this.sendWebhook({
      url,
      payload,
      headers: {
        'X-Auxx-Signature': signature,
        'X-Webhook-Signature': signature,
        ...additionalHeaders,
      },
    })
    if (!response.success) {
      return Result.error(response.error || new Error('Failed to send signed webhook'))
    }
    return Result.ok(response)
  }
  generateWebhookSignature(payload: WebhookPayload, secret: string): string {
    const payloadString = JSON.stringify(payload)
    return createHmac('sha256', secret).update(payloadString).digest('hex')
  }
  async sendWebhook({
    url: _url,
    payload: _payload,
    headers: _headers = {},
  }: WebhookSendOptions): Promise<WebhookSendResponse> {
    try {
      const response = {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: 'Webhook sent successfully' }),
      }
      // const response = await fetch(url, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json', ...headers },
      //   body: JSON.stringify(payload),
      // })
      return {
        success: response.ok,
        statusCode: response.status,
        responseBody: await response.text(),
      }
    } catch (error) {
      return {
        success: false,
        statusCode: 0,
        error: error instanceof Error ? error : new Error('Unknown error'),
      }
    }
  }
  async testEndpoint({ url }: { url: string }): Promise<TypedResult<WebhookTestResponse, Error>> {
    const response = await this.sendWebhook({
      url,
      headers: { 'User-Agent': 'Auxx-Webhook-Test' },
      payload: {
        event: 'test',
        timestamp: new Date().toISOString(),
        data: { message: 'This is a test webhook from Auxx' },
      },
    })
    if (!response.success) {
      // Network connectivity issues
      if (
        response.error?.message?.includes('ECONNREFUSED') ||
        response.error?.message?.includes('ECONNRESET')
      ) {
        return Result.error(
          new Error(
            'Could not connect to the webhook URL. Please check if the server is running and accessible.'
          )
        )
      }
      if (response.error?.message?.includes('ETIMEDOUT')) {
        return Result.error(
          new Error('Connection timed out. The webhook server took too long to respond.')
        )
      }
      if (response.error?.message?.includes('CERT_')) {
        return Result.error(
          new Error(
            'SSL/TLS certificate validation failed. Please check the certificate configuration.'
          )
        )
      }
      // HTTP status code based errors
      if (response.statusCode) {
        if (response.statusCode === 404) {
          return Result.error(
            new Error('Webhook URL not found (404). Please verify the endpoint URL.')
          )
        }
        if (response.statusCode === 401 || response.statusCode === 403) {
          return Result.error(
            new Error('Authentication failed. The webhook endpoint requires valid credentials.')
          )
        }
        if (response.statusCode === 405) {
          return Result.error(
            new Error('Method not allowed. The webhook endpoint does not accept POST requests.')
          )
        }
        if (response.statusCode === 429) {
          return Result.error(new Error('Rate limit exceeded. Please try again later.'))
        }
        if (response.statusCode >= 500) {
          return Result.error(
            new Error(
              `Server error (${response.statusCode}). The webhook server encountered an internal error.`
            )
          )
        }
      }
      // URL format issues
      if (response.error?.message?.includes('Invalid URL')) {
        return Result.error(
          new Error('Invalid webhook URL format. Please provide a valid HTTP/HTTPS URL.')
        )
      }
      // Fallback error
      return Result.error(
        response.error || new Error('Failed to test webhook. Please check the URL and try again.')
      )
    }
    const testResponse: WebhookTestResponse = {
      success: response.success,
      statusCode: response.statusCode,
      message: response.success
        ? 'Webhook test successful'
        : `Webhook test failed: Status ${response.statusCode}`,
    }
    return Result.ok(testResponse)
  }
  async list({ organizationId }: { organizationId: string }): Promise<Webhook[]> {
    return await this.db
      .select()
      .from(schema.Webhook)
      .where(eq(schema.Webhook.organizationId, organizationId))
  }
  async byId({
    id,
    organizationId,
  }: {
    id: string
    organizationId: string
  }): Promise<TypedResult<Webhook, Error>> {
    const [webhook] = await this.db
      .select()
      .from(schema.Webhook)
      .where(and(eq(schema.Webhook.id, id), eq(schema.Webhook.organizationId, organizationId)))
      .limit(1)
    if (!webhook) {
      return Result.error(new NotFoundError('Webhook not found'))
    }
    return Result.ok(webhook)
  }
  async createWebhook({ params }: { params: CreateWebhookParams }) {
    const { organizationId, name, url, eventTypes = [], isActive } = params
    logger.info('Creating webhook', { organizationId, name, url, eventTypes, isActive })
    this.validateEventTypes(eventTypes)
    const secret = randomBytes(32).toString('hex')
    const [webhook] = await this.db
      .insert(schema.Webhook)
      .values({
        organizationId,
        name,
        url,
        secret,
        eventTypes: eventTypes || [],
        isActive,
        updatedAt: new Date(),
      })
      .returning()
    if (!webhook) {
      logger.error('Failed to create webhook', { organizationId, name, url, eventTypes, isActive })
      return Result.error(new UnprocessableEntityError('Failed to create webhook'))
    }
    return Result.ok(webhook)
  }
  async updateWebhook({ params }: { params: UpdateWebhookParams }) {
    const { id, name, url, eventTypes = [], isActive } = params
    logger.info('Updating webhook', { id, name, url, eventTypes, isActive })
    this.validateEventTypes(eventTypes)
    const [webhook] = await this.db
      .update(schema.Webhook)
      .set({ name, url, eventTypes: eventTypes || [], isActive, updatedAt: new Date() })
      .where(eq(schema.Webhook.id, id))
      .returning()
    if (!webhook) {
      return Result.error(new UnprocessableEntityError('Failed to update webhook'))
    }
    return Result.ok(webhook)
  }
  async deleteWebhook({ id }: { id: string }) {
    const [webhook] = await this.db
      .delete(schema.Webhook)
      .where(eq(schema.Webhook.id, id))
      .returning()
    if (!webhook) {
      return Result.error(new NotFoundError('Failed to delete webhook'))
    }
    return Result.ok(webhook)
  }
  /**
   * Validates that all event types are recognized
   * @param eventTypes - Array of event types to validate
   * @throws UnprocessableEntityError if any event type is invalid
   */
  private validateEventTypes(eventTypes: string[]): void {
    const validEventTypes = Object.values(WEBHOOK_EVENT_TYPES)
    const invalidEventTypes = eventTypes.filter((type) => !validEventTypes.includes(type))
    if (invalidEventTypes.length > 0) {
      throw new UnprocessableEntityError(`Invalid event types: ${invalidEventTypes.join(', ')}`)
    }
  }
}
