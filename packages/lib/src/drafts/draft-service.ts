// packages/lib/src/drafts/draft-service.ts

import { type Database, schema } from '@auxx/database'
import { eq, and, inArray, isNull } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import {
  type Draft,
  type DraftContent,
  type CreateDraftInput,
  type UpdateDraftInput,
  type UpsertDraftInput,
  type StandaloneDraftMeta,
  DEFAULT_DRAFT_CONTENT,
} from '@auxx/types/draft'

const logger = createScopedLogger('draft-service')

/**
 * Service for managing email drafts.
 * Drafts are stored in a dedicated table with JSON content for fast autosave.
 */
export class DraftService {
  private db: Database
  private organizationId: string
  private userId: string

  constructor(db: Database, organizationId: string, userId: string) {
    this.db = db
    this.organizationId = organizationId
    this.userId = userId
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Creates a new draft.
   * For thread drafts, fails if user already has a draft for that thread.
   */
  async create(input: CreateDraftInput): Promise<Draft> {
    logger.info('Creating draft', {
      userId: this.userId,
      threadId: input.threadId,
      integrationId: input.integrationId,
    })

    const content: DraftContent = {
      ...DEFAULT_DRAFT_CONTENT,
      ...input.content,
    }

    const [draft] = await this.db
      .insert(schema.Draft)
      .values({
        organizationId: this.organizationId,
        createdById: this.userId,
        integrationId: input.integrationId,
        threadId: input.threadId || null,
        inReplyToMessageId: input.inReplyToMessageId || null,
        content,
      })
      .returning()

    if (!draft) {
      throw new Error('Failed to create draft')
    }

    logger.info('Draft created', { draftId: draft.id })
    return this.mapToDraft(draft)
  }

  /**
   * Updates an existing draft's content.
   * Merges the provided content with existing content.
   */
  async update(input: UpdateDraftInput): Promise<Draft> {
    const { draftId, content: contentUpdates } = input

    logger.info('Updating draft', { draftId, userId: this.userId })

    // Get existing draft
    const existing = await this.db.query.Draft.findFirst({
      where: and(
        eq(schema.Draft.id, draftId),
        eq(schema.Draft.createdById, this.userId),
        eq(schema.Draft.organizationId, this.organizationId)
      ),
    })

    if (!existing) {
      throw new Error(`Draft ${draftId} not found`)
    }

    // Merge content (shallow merge at top level, deep merge for recipients)
    const existingContent = (existing.content as DraftContent) || DEFAULT_DRAFT_CONTENT
    const mergedContent: DraftContent = {
      ...existingContent,
      ...contentUpdates,
      recipients: {
        to: contentUpdates.recipients?.to ?? existingContent.recipients?.to ?? [],
        cc: contentUpdates.recipients?.cc ?? existingContent.recipients?.cc ?? [],
        bcc: contentUpdates.recipients?.bcc ?? existingContent.recipients?.bcc ?? [],
      },
      attachments: contentUpdates.attachments ?? existingContent.attachments ?? [],
      metadata: {
        ...existingContent.metadata,
        ...contentUpdates.metadata,
      },
    }

    const [updated] = await this.db
      .update(schema.Draft)
      .set({ content: mergedContent })
      .where(
        and(
          eq(schema.Draft.id, draftId),
          eq(schema.Draft.createdById, this.userId),
          eq(schema.Draft.organizationId, this.organizationId)
        )
      )
      .returning()

    if (!updated) {
      throw new Error(`Failed to update draft ${draftId}`)
    }

    logger.info('Draft updated', { draftId })
    return this.mapToDraft(updated)
  }

  /**
   * Creates or updates a draft.
   * If draftId is provided, updates that draft.
   * If threadId is provided without draftId, finds existing draft for that thread.
   * Otherwise creates a new draft.
   */
  async upsert(input: UpsertDraftInput): Promise<Draft> {
    const { draftId, threadId, integrationId, inReplyToMessageId, content } = input

    // If we have a draft ID, update it
    if (draftId) {
      return this.update({ draftId, content })
    }

    // If we have a thread ID, check for existing draft
    if (threadId) {
      const existing = await this.getByThreadId(threadId)
      if (existing) {
        return this.update({ draftId: existing.id, content })
      }
    }

    // Create new draft
    return this.create({
      integrationId,
      threadId,
      inReplyToMessageId,
      content,
    })
  }

  /**
   * Deletes a draft.
   * Only the creator can delete their own draft.
   */
  async delete(draftId: string): Promise<{ success: boolean }> {
    logger.info('Deleting draft', { draftId, userId: this.userId })

    const result = await this.db
      .delete(schema.Draft)
      .where(
        and(
          eq(schema.Draft.id, draftId),
          eq(schema.Draft.createdById, this.userId),
          eq(schema.Draft.organizationId, this.organizationId)
        )
      )
      .returning({ id: schema.Draft.id })

    if (result.length === 0) {
      logger.warn('Draft not found or already deleted', { draftId })
      // Return success anyway - idempotent delete
      return { success: true }
    }

    logger.info('Draft deleted', { draftId })
    return { success: true }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Gets a draft by ID.
   * Returns null if not found or not owned by user.
   */
  async getById(draftId: string): Promise<Draft | null> {
    const draft = await this.db.query.Draft.findFirst({
      where: and(
        eq(schema.Draft.id, draftId),
        eq(schema.Draft.createdById, this.userId),
        eq(schema.Draft.organizationId, this.organizationId)
      ),
    })

    return draft ? this.mapToDraft(draft) : null
  }

  /**
   * Gets the user's draft for a specific thread.
   * Returns null if no draft exists.
   */
  async getByThreadId(threadId: string): Promise<Draft | null> {
    const draft = await this.db.query.Draft.findFirst({
      where: and(
        eq(schema.Draft.threadId, threadId),
        eq(schema.Draft.createdById, this.userId),
        eq(schema.Draft.organizationId, this.organizationId)
      ),
    })

    return draft ? this.mapToDraft(draft) : null
  }

  /**
   * Checks if a thread has a draft for the current user.
   * Lightweight query for UI indicators.
   */
  async hasDraft(threadId: string): Promise<boolean> {
    const draft = await this.db.query.Draft.findFirst({
      where: and(
        eq(schema.Draft.threadId, threadId),
        eq(schema.Draft.createdById, this.userId),
        eq(schema.Draft.organizationId, this.organizationId)
      ),
      columns: { id: true },
    })
    return !!draft
  }

  /**
   * Gets the draft ID for a thread (if exists).
   */
  async getDraftId(threadId: string): Promise<string | null> {
    const draft = await this.db.query.Draft.findFirst({
      where: and(
        eq(schema.Draft.threadId, threadId),
        eq(schema.Draft.createdById, this.userId),
        eq(schema.Draft.organizationId, this.organizationId)
      ),
      columns: { id: true },
    })
    return draft?.id ?? null
  }

  /**
   * Gets all drafts for the current user.
   * Ordered by most recently updated.
   */
  async listUserDrafts(options?: { limit?: number }): Promise<Draft[]> {
    const { desc } = await import('drizzle-orm')

    const drafts = await this.db.query.Draft.findMany({
      where: and(
        eq(schema.Draft.createdById, this.userId),
        eq(schema.Draft.organizationId, this.organizationId)
      ),
      orderBy: [desc(schema.Draft.updatedAt)],
      limit: options?.limit ?? 50,
    })

    return drafts.map((d) => this.mapToDraft(d))
  }

  /**
   * Gets standalone draft metadata by IDs.
   * Only returns drafts that are standalone (no threadId) and owned by the user.
   */
  async getStandaloneDraftMetas(ids: string[]): Promise<StandaloneDraftMeta[]> {
    if (ids.length === 0) return []

    const drafts = await this.db.query.Draft.findMany({
      where: and(
        inArray(schema.Draft.id, ids),
        isNull(schema.Draft.threadId),
        eq(schema.Draft.createdById, this.userId),
        eq(schema.Draft.organizationId, this.organizationId)
      ),
      with: {
        integration: { columns: { provider: true } },
      },
    })

    return drafts.map((d) => this.toStandaloneDraftMeta(d))
  }

  /**
   * Converts a draft database row to StandaloneDraftMeta.
   */
  private toStandaloneDraftMeta(draft: any): StandaloneDraftMeta {
    const content = (draft.content as DraftContent) || DEFAULT_DRAFT_CONTENT

    return {
      id: draft.id,
      integrationId: draft.integrationId,
      integrationProvider: draft.integration?.provider ?? null,
      subject: content.subject || null,
      snippet: this.extractSnippet(content),
      recipientSummary: this.buildRecipientSummary(content),
      updatedAt: draft.updatedAt.toISOString(),
      createdAt: draft.createdAt.toISOString(),
    }
  }

  /**
   * Extracts a snippet from draft content for list display.
   */
  private extractSnippet(content: DraftContent): string | null {
    if (content.bodyText) {
      return content.bodyText.slice(0, 100)
    }
    if (content.bodyHtml) {
      // Strip HTML tags for snippet
      return content.bodyHtml.replace(/<[^>]*>/g, '').slice(0, 100)
    }
    return null
  }

  /**
   * Builds a summary of recipients for list display.
   * Format: "first@example.com" or "first@example.com +2"
   */
  private buildRecipientSummary(content: DraftContent): string | null {
    const toRecipients = content.recipients?.to ?? []
    const ccRecipients = content.recipients?.cc ?? []
    const total = toRecipients.length + ccRecipients.length

    if (total === 0) return null

    const first = toRecipients[0]
    const name = first?.name || first?.identifier || 'Unknown'

    if (total === 1) return name
    return `${name} +${total - 1}`
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEND OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Marks a draft as being sent.
   * Called by MessageSenderService after successfully creating the message.
   * Deletes the draft since it's been transformed to a message.
   */
  async markAsSent(draftId: string): Promise<void> {
    logger.info('Marking draft as sent (deleting)', { draftId })
    await this.delete(draftId)
  }

  /**
   * Extracts draft content for message creation.
   * Used by MessageSenderService when sending a draft.
   */
  async getForSending(draftId: string): Promise<{
    draft: Draft
    content: DraftContent
  } | null> {
    const draft = await this.getById(draftId)
    if (!draft) return null

    return {
      draft,
      content: draft.content,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROVIDER SYNC OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Updates provider sync IDs after syncing with Gmail/Outlook.
   */
  async updateProviderIds(
    draftId: string,
    providerId: string,
    providerThreadId?: string
  ): Promise<void> {
    await this.db
      .update(schema.Draft)
      .set({
        providerId,
        providerThreadId: providerThreadId || null,
      })
      .where(
        and(eq(schema.Draft.id, draftId), eq(schema.Draft.organizationId, this.organizationId))
      )
  }

  /**
   * Finds a draft by its provider ID (for sync reconciliation).
   */
  async getByProviderId(providerId: string): Promise<Draft | null> {
    const draft = await this.db.query.Draft.findFirst({
      where: and(
        eq(schema.Draft.providerId, providerId),
        eq(schema.Draft.organizationId, this.organizationId)
      ),
    })

    return draft ? this.mapToDraft(draft) : null
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Maps database row to Draft type with proper content typing.
   */
  private mapToDraft(row: any): Draft {
    return {
      id: row.id,
      organizationId: row.organizationId,
      createdById: row.createdById,
      threadId: row.threadId,
      inReplyToMessageId: row.inReplyToMessageId,
      integrationId: row.integrationId,
      content: (row.content as DraftContent) || DEFAULT_DRAFT_CONTENT,
      providerId: row.providerId,
      providerThreadId: row.providerThreadId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }
}
