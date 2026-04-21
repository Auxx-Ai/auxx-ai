// packages/lib/src/email/email-storage.ts
//
// Legacy compatibility shim. All ingest logic lives in `packages/lib/src/ingest/`;
// this file keeps the `MessageStorageService` class alive for existing callers
// that instantiate it directly (providers, webhook routes, tests).
//
// New code should use `createIngestContext` + the functional exports from
// `@auxx/lib/ingest` instead of this class.

import {
  EmailLabel,
  IdentifierType as IdentifierTypeEnum,
  MessageType,
  ParticipantRole as ParticipantRoleEnum,
  ThreadStatus,
} from '@auxx/database/enums'
import type { MessageEntity as Message, ThreadEntity as Thread } from '@auxx/database/types'
import {
  batchStoreMessages,
  createContactAfterOutboundMessage,
  createIngestContext,
  deleteMessagesByExternalIds,
  ensureContactsForRecipients,
  getThread,
  getThreadMessages,
  type IngestContext,
  type IntegrationSettings,
  normalizeOwnEmails,
  storeMessage,
} from '../ingest'

// Type re-exports (MessageData etc. live in ingest/types now)
export type {
  IntegrationSettings,
  MessageAttachmentMeta,
  MessageData,
  ParticipantInputData,
} from '../ingest/types'

// Enum re-exports preserved for backwards compat.
export {
  EmailLabel,
  IdentifierTypeEnum as IdentifierType,
  MessageType,
  ParticipantRoleEnum as ParticipantRole,
  ThreadStatus,
}

/**
 * Thin compatibility wrapper around the functional ingest pipeline.
 *
 * Behaviour:
 * - Each call lazily builds (and caches) an `IngestContext` — so you can
 *   still do `new MessageStorageService(orgId)` and call `storeMessage`
 *   repeatedly without re-running system-user resolution.
 * - Callers that construct without an organizationId pull it from
 *   `messageData.organizationId` on first call (webhook handlers).
 * - `setIntegrationSettings` / `setInitialSyncMode` write onto the cached
 *   context, preserving existing call-site ergonomics.
 */
export class MessageStorageService {
  private readonly ctxByOrg = new Map<string, Promise<IngestContext>>()
  private integrationSettings?: IntegrationSettings
  private isInitialSync = false
  private ownEmails: Set<string> = new Set()
  private readonly defaultOrganizationId?: string

  constructor(organizationId?: string) {
    this.defaultOrganizationId = organizationId
  }

  setIntegrationSettings(settings: IntegrationSettings | undefined): void {
    this.integrationSettings = settings
    for (const ctxPromise of this.ctxByOrg.values()) {
      ctxPromise.then((ctx) => {
        ctx.integrationSettings = settings
      })
    }
  }

  setInitialSyncMode(enabled: boolean): void {
    this.isInitialSync = enabled
    for (const ctxPromise of this.ctxByOrg.values()) {
      ctxPromise.then((ctx) => {
        ctx.isInitialSync = enabled
      })
    }
  }

  /**
   * Replace the set of "own" email addresses (`Integration.email` plus any
   * verified send-as / alias addresses) used to classify message participants
   * as internal. Providers should call this after `initialize()` so that
   * self-addressed mail never produces a contact for the integration owner.
   */
  setOwnEmails(emails: Iterable<string> | undefined): void {
    const normalized = normalizeOwnEmails(emails)
    this.ownEmails = normalized
    for (const ctxPromise of this.ctxByOrg.values()) {
      ctxPromise.then((ctx) => {
        ctx.ownEmails = new Set(normalized)
      })
    }
  }

  async storeMessage(
    messageData: Parameters<typeof storeMessage>[1]
  ): Promise<{ messageId: string; isNew: boolean }> {
    const ctx = await this.resolveCtx(messageData.organizationId)
    return storeMessage(ctx, messageData)
  }

  async batchStoreMessages(
    messages: Parameters<typeof batchStoreMessages>[1],
    batchId?: string,
    isInitialSync = false
  ): Promise<number> {
    const orgId = messages[0]?.organizationId
    if (!orgId) return 0
    const ctx = await this.resolveCtx(orgId)
    return batchStoreMessages(ctx, messages, { batchId, isInitialSync })
  }

  async deleteMessagesByExternalIds(integrationId: string, externalIds: string[]): Promise<number> {
    const ctx = await this.resolveCtx(this.defaultOrganizationId)
    return deleteMessagesByExternalIds(ctx, { integrationId, externalIds })
  }

  async createContactAfterOutboundMessage(
    participantId: string,
    organizationId: string
  ): Promise<void> {
    const ctx = await this.resolveCtx(organizationId)
    return createContactAfterOutboundMessage(ctx, participantId)
  }

  async ensureContactsForRecipients(
    recipients: string[],
    organizationId: string,
    integrationId: string
  ): Promise<void> {
    const ctx = await this.resolveCtx(organizationId)
    return ensureContactsForRecipients(ctx, { recipients, integrationId })
  }

  async getThread(threadId: string, organizationId: string): Promise<Thread | null> {
    const ctx = await this.resolveCtx(organizationId)
    return getThread(ctx, { threadId, organizationId })
  }

  async getThreadMessages(threadId: string): Promise<Message[]> {
    const ctx = await this.resolveCtx(this.defaultOrganizationId)
    return getThreadMessages(ctx, threadId)
  }

  private async resolveCtx(organizationId?: string): Promise<IngestContext> {
    const orgId = organizationId ?? this.defaultOrganizationId
    if (!orgId) {
      throw new Error(
        'MessageStorageService requires an organizationId — pass one to the constructor or include it on the message.'
      )
    }
    const cached = this.ctxByOrg.get(orgId)
    if (cached) return cached
    const promise = createIngestContext(orgId, {
      integrationSettings: this.integrationSettings,
      isInitialSync: this.isInitialSync,
      ownEmails: this.ownEmails,
    })
    this.ctxByOrg.set(orgId, promise)
    return promise
  }
}
