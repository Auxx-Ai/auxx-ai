// packages/lib/src/providers/message-provider-interface.ts

import { type IntegrationProviderType } from '@auxx/database/types'
import { type ProviderCapabilities } from './provider-capabilities'

/**
 * Extended interface for message providers with capability support
 */
export interface MessageProvider {
  // Provider identification
  type: IntegrationProviderType
  integrationId: string
  organizationId: string

  // Capability declaration
  getCapabilities(): ProviderCapabilities

  // Core message operations
  sendMessage?(params: SendMessageParams): Promise<SendMessageResult>
  replyToMessage?(params: ReplyMessageParams): Promise<SendMessageResult>
  forwardMessage?(params: ForwardMessageParams): Promise<SendMessageResult>

  // Draft operations
  createDraft?(params: CreateDraftParams): Promise<DraftResult>
  updateDraft?(draftId: string, params: UpdateDraftParams): Promise<DraftResult>
  sendDraft?(draftId: string): Promise<SendMessageResult>

  // Message management
  deleteMessage?(messageId: string): Promise<void>
  archiveMessage?(messageId: string): Promise<void>
  markAsSpam?(messageId: string): Promise<void>
  markAsTrash?(messageId: string): Promise<void>

  // Thread operations
  archiveThread?(threadId: string): Promise<void>
  unarchiveThread?(threadId: string): Promise<void>
  markThreadAsSpam?(threadId: string): Promise<void>
  moveThreadToTrash?(threadId: string): Promise<void>

  // Label operations
  addLabel?(
    labelId: string,
    targetId: string,
    targetType: 'message' | 'thread' | 'conversation'
  ): Promise<void>
  removeLabel?(
    labelId: string,
    targetId: string,
    targetType: 'message' | 'thread' | 'conversation'
  ): Promise<void>
  createLabel?(name: string, color?: string): Promise<{ id: string; name: string }>
  getLabels?(): Promise<ProviderLabel[]>

  // Search operations
  searchMessages?(query: string, options?: SearchOptions): Promise<SearchResult[]>

  // Attachment operations
  uploadAttachment?(file: AttachmentFile): Promise<AttachmentResult>
  downloadAttachment?(attachmentId: string): Promise<AttachmentFile>

  // Social media specific
  reactToMessage?(messageId: string, reaction: string): Promise<void>
  shareMessage?(messageId: string, options?: ShareOptions): Promise<void>

  // Provider-specific operations
  executeCustomAction?(actionName: string, params: any): Promise<any>
}

/**
 * Parameters for sending a message
 */
export interface SendMessageParams {
  to: string[]
  from: string
  subject?: string
  textHtml?: string
  textPlain?: string
  cc?: string[]
  bcc?: string[]
  attachments?: AttachmentFile[]
  metadata?: Record<string, any>
  scheduledAt?: Date
  templateId?: string
}

/**
 * Parameters for replying to a message
 */
export interface ReplyMessageParams extends SendMessageParams {
  inReplyTo: string
  references?: string
  threadId?: string
  includeOriginal?: boolean
}

/**
 * Parameters for forwarding a message
 */
export interface ForwardMessageParams {
  originalMessageId: string
  to: string[]
  from: string
  comment?: string
  includeAttachments?: boolean
}

/**
 * Parameters for creating a draft
 */
export interface CreateDraftParams {
  to?: string[]
  from?: string
  subject?: string
  textHtml?: string
  textPlain?: string
  cc?: string[]
  bcc?: string[]
  attachments?: AttachmentFile[]
  inReplyTo?: string
  threadId?: string
}

/**
 * Parameters for updating a draft
 */
export interface UpdateDraftParams extends Partial<CreateDraftParams> {}

/**
 * Result of sending a message
 */
export interface SendMessageResult {
  id?: string
  externalId?: string
  threadId?: string
  success: boolean
  error?: string
  timestamp?: Date
}

/**
 * Result of draft operations
 */
export interface DraftResult {
  id: string
  externalId?: string
  threadId?: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Provider label representation
 */
export interface ProviderLabel {
  id: string
  name: string
  color?: string
  type?: 'system' | 'user'
  metadata?: Record<string, any>
}

/**
 * Search options
 */
export interface SearchOptions {
  limit?: number
  offset?: number
  startDate?: Date
  endDate?: Date
  hasAttachments?: boolean
  labelIds?: string[]
  folder?: string
}

/**
 * Search result
 */
export interface SearchResult {
  messageId: string
  threadId?: string
  subject?: string
  snippet?: string
  from: string
  to: string[]
  date: Date
  hasAttachments: boolean
  labels?: string[]
  score?: number
}

/**
 * Attachment file representation
 */
export interface AttachmentFile {
  filename: string
  content: Buffer | string
  contentType: string
  size?: number
  id?: string
  contentId?: string // For inline images
  inline?: boolean // Mark as inline attachment
}

/**
 * Attachment result
 */
export interface AttachmentResult {
  id: string
  filename: string
  size: number
  contentType: string
  url?: string
}

/**
 * Share options for social media
 */
export interface ShareOptions {
  comment?: string
  visibility?: 'public' | 'friends' | 'private'
  platforms?: string[]
}

/**
 * Abstract base class for message providers
 */
export abstract class BaseMessageProvider implements MessageProvider {
  constructor(
    public type: IntegrationProviderType,
    public integrationId: string | null,
    public organizationId: string
  ) {}

  abstract getCapabilities(): ProviderCapabilities

  /**
   * Helper method to check if an operation is supported
   */
  protected checkCapability(capability: keyof ProviderCapabilities): void {
    const capabilities = this.getCapabilities()
    if (!capabilities[capability]) {
      throw new Error(`Operation not supported by ${this.type} provider: ${capability}`)
    }
  }

  /**
   * Helper method to check label scope
   */
  protected checkLabelScope(targetType: 'message' | 'thread' | 'conversation'): void {
    const capabilities = this.getCapabilities()
    const scope = capabilities.labelScope

    if (scope === 'none') {
      throw new Error(`${this.type} provider does not support labels`)
    }

    if (targetType === 'message' && scope !== 'message') {
      throw new Error(`${this.type} provider does not support message-level labels`)
    }

    if (targetType === 'conversation' && scope === 'message') {
      throw new Error(`${this.type} provider only supports message-level labels`)
    }
  }
}
