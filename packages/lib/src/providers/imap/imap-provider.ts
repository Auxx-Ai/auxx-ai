// packages/lib/src/providers/imap/imap-provider.ts

import { CredentialService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { IntegrationProviderType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { MessageStorageService } from '../../email/email-storage'
import { NotFoundError } from '../../errors'
import type {
  IntegrationProvider,
  MessageListResult,
  MessageStatus,
  SendMessageOptions,
} from '../integration-provider.interface'
import { BaseMessageProvider, type MessageProvider } from '../message-provider-interface'
import { getProviderCapabilities, type ProviderCapabilities } from '../provider-capabilities'
import { ImapClientProvider } from './imap-client-provider'
import { ImapGetAllFoldersService } from './imap-get-all-folders'
import { ImapGetMessageListService } from './imap-get-message-list'
import { ImapGetMessagesService } from './imap-get-messages'
import { ImapSmtpSendService } from './imap-send-message'
import { LdapAuthService } from './ldap-auth-service'
import type { ImapCredentialData } from './types'

const logger = createScopedLogger('imap-provider')

export class ImapProvider
  extends BaseMessageProvider
  implements IntegrationProvider, MessageProvider
{
  private integration:
    | (typeof schema.Integration.$inferSelect & { inboxIntegration?: any })
    | null = null
  private inboxId: string | undefined = undefined
  private credentials!: ImapCredentialData
  private storageService: MessageStorageService

  private clientProvider = new ImapClientProvider()
  private messageListService = new ImapGetMessageListService()
  private getMessagesService = new ImapGetMessagesService()
  private folderService = new ImapGetAllFoldersService()
  private smtpService = new ImapSmtpSendService()
  private ldapAuthService = new LdapAuthService()

  constructor(organizationId: string) {
    super(IntegrationProviderType.imap, '', organizationId)
    this.storageService = new MessageStorageService(organizationId)
  }

  // === Core lifecycle ===

  getCapabilities(): ProviderCapabilities {
    return getProviderCapabilities(IntegrationProviderType.imap)
  }

  async initialize(integrationId: string): Promise<void> {
    logger.info(`Initializing ImapProvider for integration: ${integrationId}`)
    ;(this as any).integrationId = integrationId

    // Load integration + inbox integration
    const [integrationData] = await db
      .select({
        integration: schema.Integration,
        inboxIntegration: schema.InboxIntegration,
      })
      .from(schema.Integration)
      .leftJoin(
        schema.InboxIntegration,
        eq(schema.InboxIntegration.integrationId, schema.Integration.id)
      )
      .where(
        and(
          eq(schema.Integration.id, integrationId),
          eq(schema.Integration.organizationId, this.organizationId)
        )
      )
      .limit(1)

    const integration = integrationData
      ? {
          ...integrationData.integration,
          inboxIntegration: integrationData.inboxIntegration,
        }
      : null

    this.inboxId = integration?.inboxIntegration?.inboxId

    if (!integration || integration.provider !== 'imap' || !integration.enabled) {
      throw new Error(`IMAP integration ${integrationId} not found, not IMAP, or disabled`)
    }

    this.integration = integration

    // Decrypt full credential data (NOT IntegrationTokenAccessor — that only returns OAuth tokens)
    if (!integration.credentialId) {
      throw new Error(`IMAP integration ${integrationId} has no linked credentials`)
    }

    const [credRow] = await db
      .select({ encryptedData: schema.WorkflowCredentials.encryptedData })
      .from(schema.WorkflowCredentials)
      .where(
        and(
          eq(schema.WorkflowCredentials.id, integration.credentialId),
          eq(schema.WorkflowCredentials.organizationId, this.organizationId)
        )
      )
      .limit(1)

    if (!credRow?.encryptedData) {
      throw new Error(`Credentials not found for IMAP integration ${integrationId}`)
    }

    this.credentials = CredentialService.decrypt(credRow.encryptedData) as ImapCredentialData

    // Optional LDAP verification
    if (this.credentials.authMode === 'ldap' && this.credentials.ldap) {
      const userInfo = await this.ldapAuthService.verifyCredentials(
        this.credentials.ldap,
        this.credentials.imap.username,
        this.credentials.imap.password
      )
      if (userInfo.username !== this.credentials.imap.username) {
        logger.info('LDAP resolved different username', {
          original: this.credentials.imap.username,
          resolved: userInfo.username,
        })
        this.credentials.imap.username = userInfo.username
      }
    }

    // Initialize SMTP for sending
    await this.smtpService.initialize(this.credentials)

    logger.info(`ImapProvider initialized for ${integration.email}`)
  }

  getProviderName(): string {
    return 'imap'
  }

  // === Two-Phase Polling Sync ===

  supportsTwoPhaseSync(): boolean {
    return true
  }

  async fetchMessageIds(_since?: Date): Promise<MessageListResult[]> {
    return this.messageListService.getMessageLists({
      credentials: this.credentials,
      integrationId: (this as any).integrationId,
      organizationId: this.organizationId,
    })
  }

  async importMessages(externalIds: string[]): Promise<{ imported: number; failed: number }> {
    const messages = await this.getMessagesService.getMessages({
      externalIds,
      credentials: this.credentials,
      integrationId: (this as any).integrationId,
      organizationId: this.organizationId,
      inboxId: this.inboxId,
      userEmail: this.integration?.email || '',
    })

    let imported = 0
    let failed = 0

    for (const message of messages) {
      try {
        await this.storageService.storeMessage(message)
        imported++
      } catch (error) {
        logger.error('Failed to store IMAP message', {
          externalId: message.externalId,
          error: error instanceof Error ? error.message : String(error),
        })
        failed++
      }
    }

    return { imported, failed }
  }

  async discoverLabels(): Promise<
    {
      externalId: string
      name: string
      isSentBox: boolean
      parentExternalId: string | null
    }[]
  > {
    return this.folderService.getAllMessageFolders(this.credentials)
  }

  // === Single-phase sync fallback ===

  async syncMessages(_since?: Date): Promise<void> {
    const results = await this.fetchMessageIds()
    const allIds = results.flatMap((r) => r.messageIds)

    if (allIds.length > 0) {
      await this.importMessages(allIds)
    }
  }

  // === Sending ===

  async sendMessage(options: SendMessageOptions): Promise<{ id?: string; success: boolean }> {
    return this.smtpService.sendMessage(options)
  }

  // === Webhooks (not supported — IMAP is polling-only) ===

  async setupWebhook(_callbackUrl: string): Promise<void> {
    logger.debug('setupWebhook called on IMAP provider (no-op)')
  }

  async removeWebhook(): Promise<void> {}

  // === Message operations ===

  async archive(_externalId: string, _type: 'message' | 'thread'): Promise<boolean> {
    return false
  }

  async markAsSpam(_externalId: string, _type: 'message' | 'thread'): Promise<boolean> {
    return false
  }

  async trash(externalId: string, _type: 'message' | 'thread'): Promise<boolean> {
    // TODO: Move message to Trash folder via IMAP COPY + DELETE
    logger.warn('IMAP trash not yet implemented', { externalId })
    return false
  }

  async restore(_externalId: string, _type: 'message' | 'thread'): Promise<boolean> {
    return false
  }

  // === Draft operations (not supported) ===

  async createDraft(_options: SendMessageOptions): Promise<{ id: string; success: boolean }> {
    throw new NotFoundError('IMAP provider does not support drafts')
  }

  async updateDraft(_draftId: string, _options: Partial<SendMessageOptions>): Promise<boolean> {
    return false
  }

  async sendDraft(_draftId: string): Promise<{ id: string; success: boolean }> {
    throw new NotFoundError('IMAP provider does not support drafts')
  }

  // === Label/Folder operations ===

  async getLabels(): Promise<any[]> {
    return this.folderService.getAllMessageFolders(this.credentials)
  }

  async createLabel(_options: { name: string; color?: string; visible?: boolean }): Promise<any> {
    throw new NotFoundError('IMAP folder creation not yet implemented')
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

  // === Thread operations ===

  async getThread(_externalThreadId: string): Promise<any> {
    return null
  }

  async updateThreadStatus(_externalThreadId: string, _status: MessageStatus): Promise<boolean> {
    return false
  }

  async moveThread(_externalThreadId: string, _destinationLabelId: string): Promise<boolean> {
    return false
  }

  // === Test ===

  async simulateOperation(_operation: string, _targetId: string, _params?: any): Promise<any> {
    return null
  }
}
