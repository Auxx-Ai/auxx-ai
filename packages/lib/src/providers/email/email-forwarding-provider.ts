// packages/lib/src/providers/email/email-forwarding-provider.ts

import { database as db, schema } from '@auxx/database'
import { IntegrationProviderType } from '@auxx/database/enums'
import { NodemailerService } from '@auxx/email'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { NotFoundError } from '../../errors'
import type {
  ChannelProvider,
  MessageStatus,
  SendMessageOptions,
} from '../channel-provider.interface'
import { BaseMessageProvider, type MessageProvider } from '../message-provider-interface'
import { getProviderCapabilities, type ProviderCapabilities } from '../provider-capabilities'

const logger = createScopedLogger('email-forwarding-provider')

/**
 * Provider for sending outbound replies from forwarding email integrations.
 *
 * Uses the environment's configured mail transport (via NodemailerService)
 * to send from the organization's forwarding alias (e.g. acme@mail.auxx.ai).
 */
export class EmailForwardingProvider
  extends BaseMessageProvider
  implements ChannelProvider, MessageProvider
{
  private fromAddress = ''
  private displayName = ''

  constructor(organizationId: string) {
    super(IntegrationProviderType.email, '', organizationId)
  }

  getCapabilities(): ProviderCapabilities {
    return getProviderCapabilities(IntegrationProviderType.email)
  }

  async initialize(integrationId: string): Promise<void> {
    logger.info(`Initializing EmailForwardingProvider for integration: ${integrationId}`)
    ;(this as any).integrationId = integrationId

    const [row] = await db
      .select({
        integration: schema.Integration,
        organization: {
          name: schema.Organization.name,
        },
      })
      .from(schema.Integration)
      .innerJoin(schema.Organization, eq(schema.Organization.id, schema.Integration.organizationId))
      .where(
        and(
          eq(schema.Integration.id, integrationId),
          eq(schema.Integration.organizationId, this.organizationId)
        )
      )
      .limit(1)

    if (!row) {
      throw new NotFoundError(`Integration ${integrationId} not found`)
    }

    const integration = row.integration

    if (integration.provider !== 'email') {
      throw new Error(
        `Integration ${integrationId} is not an email forwarding integration (provider: ${integration.provider})`
      )
    }

    if (!integration.email) {
      throw new Error(`Integration ${integrationId} has no forwarding email address configured`)
    }

    this.fromAddress = integration.email

    // Derive display name: Integration.name → Organization.name → local part
    this.displayName =
      integration.name || row.organization.name || integration.email.split('@')[0] || 'Support'

    logger.info(`EmailForwardingProvider initialized: "${this.displayName}" <${this.fromAddress}>`)
  }

  getProviderName(): string {
    return 'email'
  }

  async sendMessage(
    options: SendMessageOptions
  ): Promise<{ id?: string; success: boolean; error?: string }> {
    const params = options as any

    // Build the formatted From header
    const from = `"${this.displayName}" <${this.fromAddress}>`

    // Accept both html/textHtml and text/textPlain field names
    const html = params.html || params.textHtml || undefined
    const text = params.text || params.textPlain || undefined

    // Map AttachmentFile[] → Attachment[] (nodemailer format)
    const attachments = params.attachments?.map((a: any) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
      cid: a.contentId,
    }))

    const emailResult = await NodemailerService.getInstance().sendEmail({
      from,
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      subject: params.subject,
      html,
      text,
      replyTo: this.fromAddress,
      inReplyTo: params.inReplyTo,
      references: params.references,
      messageId: params.messageId,
      attachments,
    })

    if (!emailResult.success) {
      logger.error('EmailForwardingProvider send failed', {
        error: emailResult.error,
        to: params.to,
        from: this.fromAddress,
      })
    }

    return {
      id: emailResult.id || undefined,
      success: emailResult.success,
      error: emailResult.error,
      timestamp: new Date(),
    } as any
  }

  // === Sync (not applicable for forwarding — inbound uses separate pipeline) ===

  async syncMessages(_since?: Date): Promise<void> {
    // No-op: forwarding integrations receive inbound mail via the inbound pipeline
  }

  // === Webhooks (not applicable) ===

  async setupWebhook(_callbackUrl: string): Promise<void> {}
  async removeWebhook(): Promise<void> {}

  // === Operations not supported by forwarding ===

  async archive(_externalId: string, _type: 'message' | 'thread'): Promise<boolean> {
    return false
  }

  async markAsSpam(_externalId: string, _type: 'message' | 'thread'): Promise<boolean> {
    return false
  }

  async trash(_externalId: string, _type: 'message' | 'thread'): Promise<boolean> {
    return false
  }

  async restore(_externalId: string, _type: 'message' | 'thread'): Promise<boolean> {
    return false
  }

  async createDraft(_options: SendMessageOptions): Promise<{ id: string; success: boolean }> {
    throw new NotFoundError('Email forwarding provider does not support drafts')
  }

  async updateDraft(_draftId: string, _options: Partial<SendMessageOptions>): Promise<boolean> {
    return false
  }

  async sendDraft(_draftId: string): Promise<{ id: string; success: boolean }> {
    throw new NotFoundError('Email forwarding provider does not support drafts')
  }

  async getLabels(): Promise<any[]> {
    return []
  }

  async createLabel(_options: { name: string; color?: string; visible?: boolean }): Promise<any> {
    throw new NotFoundError('Email forwarding provider does not support labels')
  }

  async updateLabel(_labelId: string, _options: { name?: string }): Promise<boolean> {
    return false
  }

  async deleteLabel(_labelId: string): Promise<boolean> {
    return false
  }

  async addLabel(
    _labelId: string,
    _externalId: string,
    _type: 'message' | 'thread'
  ): Promise<boolean> {
    return false
  }

  async removeLabel(
    _labelId: string,
    _externalId: string,
    _type: 'message' | 'thread'
  ): Promise<boolean> {
    return false
  }

  async getThread(_externalThreadId: string): Promise<any> {
    return null
  }

  async updateThreadStatus(_externalThreadId: string, _status: MessageStatus): Promise<boolean> {
    return false
  }

  async moveThread(_externalThreadId: string, _destinationLabelId: string): Promise<boolean> {
    return false
  }

  async simulateOperation(_operation: string, _targetId: string, _params?: any): Promise<any> {
    return null
  }
}
