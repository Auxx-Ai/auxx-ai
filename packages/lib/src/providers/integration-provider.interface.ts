import type { AttachmentFile } from './message-provider-interface'

export interface SendMessageOptions {
  // Required fields
  from: string
  to: string | string[]
  
  // Content (at least one should be provided)
  subject?: string // Optional for non-email messages
  text?: string
  html?: string
  
  // Email recipients
  cc?: string[]
  bcc?: string[]
  replyTo?: string[] // For explicit Reply-To header
  
  // Threading
  inReplyTo?: string
  references?: string
  messageId?: string // Provider-specific ID for outgoing message if available
  externalThreadId?: string // Link to existing thread if applicable
  
  // Attachments
  attachmentIds?: string[] // References to stored attachments (used by our system)
  attachments?: AttachmentFile[] // Direct attachment objects (used by providers)
  
  // Other options
  trackingEnabled?: boolean // Generic tracking flag
  metadata?: Record<string, any> // For provider-specific options (deprecated - for backward compatibility only)
}

export interface SendEmailOptions {
  to: string | string[]
  from: string
  subject: string
  text?: string
  html?: string
  inReplyTo?: string
  references?: string
  messageId?: string
  attachmentIds?: string[]
  trackingEnabled?: boolean
}

// Renamed from EmailStatus to MessageStatus for generality
export enum MessageStatus {
  READ = 'READ',
  UNREAD = 'UNREAD',
  IMPORTANT = 'IMPORTANT',
  STARRED = 'STARRED',
  ARCHIVED = 'ARCHIVED',
  SPAM = 'SPAM',
  TRASH = 'TRASH',
}

// Renamed from EmailProvider to IntegrationProvider
export interface IntegrationProvider {
  /**
   * Initializes the provider for a specific integration instance.
   * @param integrationId The ID of the integration record in the database.
   */
  initialize(integrationId: string): Promise<void>

  /**
   * Sends a message using the provider.
   * @param options Options for the message to be sent.
   * @returns A promise resolving to the result, including a success flag and potentially a provider-specific ID.
   */
  sendMessage(options: SendMessageOptions): Promise<{ id?: string; success: boolean }>

  /**
   * Sets up webhooks for real-time notifications from the provider.
   * @param callbackUrl The URL where the provider should send webhook events.
   * @returns A promise resolving when the webhook setup is complete.
   */
  setupWebhook(callbackUrl: string): Promise<void>

  /**
   * Removes previously configured webhooks.
   * @returns A promise resolving when webhooks are removed.
   */
  removeWebhook(): Promise<void>

  /**
   * Synchronizes messages from the provider since a given time.
   * @param since Optional date to fetch messages since. If omitted, provider determines default sync window.
   * @returns A promise resolving when synchronization is complete.
   */
  syncMessages(since?: Date): Promise<void>

  /**
   * Returns the unique name/key of the provider (e.g., 'google', 'outlook').
   */
  getProviderName(): string

  // === Operations on existing messages/threads ===

  /**
   * Archives a message or thread.
   * @param externalId The provider's external ID for the message or thread.
   * @param type 'message' or 'thread'.
   */
  archive(externalId: string, type: 'message' | 'thread'): Promise<boolean>

  /**
   * Marks a message or thread as spam.
   * @param externalId The provider's external ID for the message or thread.
   * @param type 'message' or 'thread'.
   */
  markAsSpam(externalId: string, type: 'message' | 'thread'): Promise<boolean>

  /**
   * Moves a message or thread to trash.
   * @param externalId The provider's external ID for the message or thread.
   * @param type 'message' or 'thread'.
   */
  trash(externalId: string, type: 'message' | 'thread'): Promise<boolean>

  /**
   * Restores a message or thread from trash/archive/spam.
   * @param externalId The provider's external ID for the message or thread.
   * @param type 'message' or 'thread'.
   */
  restore(externalId: string, type: 'message' | 'thread'): Promise<boolean>

  // === Draft operations (might be email-specific) ===

  /**
   * Creates a draft message.
   * @param options Options for the draft message.
   * @returns A promise resolving to the result, including the draft ID.
   */
  createDraft(options: SendMessageOptions): Promise<{ id: string; success: boolean }>

  /**
   * Updates an existing draft message.
   * @param draftId The provider's ID for the draft.
   * @param options Partial options to update.
   */
  updateDraft(draftId: string, options: Partial<SendMessageOptions>): Promise<boolean>

  /**
   * Sends a previously created draft message.
   * @param draftId The provider's ID for the draft.
   * @returns A promise resolving to the result, including the sent message ID.
   */
  sendDraft(draftId: string): Promise<{ id: string; success: boolean }>

  // === Label/Folder operations (might be email-specific) ===

  /**
   * Retrieves labels or folders available from the provider.
   */
  getLabels(): Promise<any[]>

  /**
   * Creates a new label or folder.
   * @param options Label/folder creation options (name, color, etc.).
   */
  createLabel(options: { name: string; color?: string; visible?: boolean }): Promise<any>

  /**
   * Updates an existing label or folder.
   * @param labelId The provider's ID for the label/folder.
   * @param options Options to update.
   */
  updateLabel(
    labelId: string,
    options: { name?: string; color?: string; visible?: boolean }
  ): Promise<boolean>

  /**
   * Deletes a label or folder.
   * @param labelId The provider's ID for the label/folder.
   */
  deleteLabel(labelId: string): Promise<boolean>

  /**
   * Adds a label/folder to a message or thread.
   * @param labelId The provider's ID for the label/folder.
   * @param externalId The provider's external ID for the message or thread.
   * @param type 'message' or 'thread'.
   */
  addLabel(labelId: string, externalId: string, type: 'message' | 'thread'): Promise<boolean>

  /**
   * Removes a label/folder from a message or thread.
   * @param labelId The provider's ID for the label/folder.
   * @param externalId The provider's external ID for the message or thread.
   * @param type 'message' or 'thread'.
   */
  removeLabel(labelId: string, externalId: string, type: 'message' | 'thread'): Promise<boolean>

  // === Thread operations (might be email-specific) ===

  /**
   * Retrieves details for a specific thread.
   * @param externalThreadId The provider's external ID for the thread.
   */
  getThread(externalThreadId: string): Promise<any>

  /**
   * Updates the status of a thread (e.g., read, unread, starred).
   * @param externalThreadId The provider's external ID for the thread.
   * @param status The new status to apply.
   */
  updateThreadStatus(externalThreadId: string, status: MessageStatus): Promise<boolean>

  /**
   * Moves a thread to a different label/folder.
   * @param externalThreadId The provider's external ID for the thread.
   * @param destinationLabelId The provider's ID for the destination label/folder.
   */
  moveThread(externalThreadId: string, destinationLabelId: string): Promise<boolean>

  // === Test/Simulation methods ===

  /**
   * Simulates an operation for testing purposes.
   * @param operation The name of the operation to simulate.
   * @param targetId The ID of the target entity (message, thread, etc.).
   * @param params Additional parameters for the simulation.
   */
  simulateOperation(operation: string, targetId: string, params?: any): Promise<any>
}
