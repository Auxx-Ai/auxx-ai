// packages/lib/src/messages/message-sender.service.ts
import { type Database, database as db, schema } from '@auxx/database'
import { IntegrationProviderType, ParticipantRole, SendStatus } from '@auxx/database/enums'
import type { ParticipantRole as ParticipantRoleType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import {
  touchActivityForThreadLinks,
  touchInteractionForThreadLinks,
} from '../entity-instances/activity'
import { ForbiddenError, UsageLimitError } from '../errors'
import { FileService } from '../files/core/file-service'
import { MediaAssetService } from '../files/core/media-asset-service'
import { ParticipantService } from '../participants/participant-service'
import type { MailViewer } from '../permissions/visibility/context'
import { isSystemViewer } from '../permissions/visibility/context'
import { getThreadLens } from '../permissions/visibility/thread-lens'
// Type-only (erased at runtime) so the lazy `await import()` of the error
// normalizer below stays lazy. Aliased because the dynamic import destructures a
// *value* binding of the same name into the same scope.
import type { NormalizedEmailError as NormalizedEmailErrorInstance } from '../providers/error-normalization'
import type { AttachmentFile } from '../providers/message-provider-interface'
import type { ProviderRegistryService } from '../providers/provider-registry-service'
import { getRealtimeService, publishMessageCreated, publishMessageUpdated } from '../realtime'
import { Result } from '../result'
import { isSuppressed } from '../sequences/suppression'
import { getOrganizationSetting } from '../settings/settings-service'
import { instrumentEmailHtml } from '../signals/email/instrument-html'
import { buildUnsubscribeUrl, issueUnsubscribeToken } from '../signals/unsubscribe'
import { createUsageGuard } from '../usage/create-usage-guard'
import { checkAutomatedSendLimits, notifyAdminsOfSendBreakerTrip } from './automated-send-guard'
import { MessageComposerService } from './message-composer.service'
import { MessageReconcilerService } from './message-reconciler.service'
import { ThreadManagerService } from './thread-manager.service'
import type {
  ComposedMessage,
  PostSendSyncJob,
  ProcessedParticipant,
  ProcessedParticipants,
  ProviderSendResponse,
  RetryMessageInput,
  RetryMessageResult,
  SendMessageInput,
  SentMessage,
  ThreadContext,
} from './types/message-sending.types'

const logger = createScopedLogger('message-sender')

/** Module default connection, reachable from inside the constructor where the
 *  `db` parameter shadows the `database as db` import. */
const defaultDb: Database = db

/**
 * What providers actually return from `sendMessage`.
 *
 * `ChannelProvider.sendMessage` declares only `{ id?, success }`, but the email
 * providers return more — Google returns `threadId` (see
 * `google-provider.ts#sendMessage`) and Gmail additionally returns `historyId` /
 * `labelIds`. Widening the shared interface belongs in `providers/`; this local
 * shape at least keeps the extra reads named instead of `(result as any).x`.
 */
type ProviderSendResult = {
  success: boolean
  id?: string
  threadId?: string
  historyId?: string
  labelIds?: string[]
}

/**
 * `Message.metadata` merge that records the provider's own error text under
 * `providerErrorRaw`.
 *
 * `providerError` holds the sanitized, user-facing string; the actionable
 * provider text (e.g. Graph's `InvalidInternetMessageHeader: … should start with
 * 'x-'`) used to survive only in a log line. This is a jsonb `||` merge, not an
 * assignment — the surrounding update statements do not read the existing
 * metadata, so overwriting the column would drop the reconciler's bookkeeping.
 */
function providerErrorRawMerge(raw: string) {
  return sql`coalesce(${schema.Message.metadata}, '{}'::jsonb) || jsonb_build_object('providerErrorRaw', ${raw}::text)`
}

/** Providers where "recipient" means an email address — suppression + List-Unsubscribe
 * apply here and nowhere else (chat/SMS/social DMs have no unsubscribe concept). */
const EMAIL_PROVIDER_TYPES: ReadonlySet<string> = new Set([
  IntegrationProviderType.google,
  IntegrationProviderType.outlook,
  IntegrationProviderType.email,
  IntegrationProviderType.mailgun,
  IntegrationProviderType.imap,
])

/**
 * Main orchestrator for sending messages
 * Coordinates thread management, composition, sending, and reconciliation
 */
export class MessageSenderService {
  private threadManager: ThreadManagerService
  private composer: MessageComposerService
  private reconciler: MessageReconcilerService
  private participantService: ParticipantService
  private mediaAssetService: MediaAssetService
  private fileService: FileService
  /** Originating socket id for self-echo suppression on realtime publishes. */
  private readonly socketId?: string

  /**
   * Visibility principal for the §7 send gate. Interactive callers (tRPC,
   * Kopilot) pass the user's context; workers / workflow / scheduled sends
   * leave it undefined, which is SYSTEM-equivalent (Phase 7 revisits).
   */
  private readonly viewer?: MailViewer

  constructor(
    private organizationId: string,
    private providerRegistry?: ProviderRegistryService,
    private db?: Database,
    socketId?: string,
    viewer?: MailViewer
  ) {
    this.viewer = viewer
    // `MessageComposerService` / `MessageReconcilerService` take a non-optional
    // `Database` and dereference it eagerly, so callers that omit `db` (e.g.
    // `email/message-service.ts`) must still get a real connection here.
    const conn = db ?? defaultDb
    this.threadManager = new ThreadManagerService(organizationId, conn)
    this.composer = new MessageComposerService(organizationId, conn)
    this.reconciler = new MessageReconcilerService(organizationId, this.threadManager, conn)
    this.participantService = new ParticipantService(organizationId, conn)
    this.mediaAssetService = new MediaAssetService(organizationId, undefined, conn)
    this.fileService = new FileService(organizationId, undefined, conn)
    this.socketId = socketId
  }
  /**
   * §7 send gate — only bites when an interactive viewer was provided.
   * `none` reads as not-found; `metadata`/`subject` as restricted.
   */
  private async assertCanSendOnThread(threadId: string | null): Promise<void> {
    if (!threadId || !this.viewer || isSystemViewer(this.viewer)) return
    const lens = await getThreadLens(this.db ?? db, this.organizationId, this.viewer, threadId)
    if (lens !== 'read') {
      throw new ForbiddenError(
        lens === 'none'
          ? 'Thread not found.'
          : 'You do not have full access to this thread and cannot send messages on it.'
      )
    }
  }

  /**
   * Check if a thread ID is a placeholder
   */
  private isPlaceholderThreadId(id?: string | null): boolean {
    if (!id) return true
    if (id.startsWith('new_') || id.startsWith('pending_') || id.startsWith('draft_')) return true
    if (id.includes('-') && id.length === 36) return true // UUID
    return false
  }
  /**
   * Main entry point for sending messages
   */
  async sendMessage(input: SendMessageInput): Promise<SentMessage> {
    logger.info('Starting message send', {
      userId: input.userId,
      organizationId: input.organizationId,
      threadId: input.threadId,
      subject: input.subject,
      recipientCount: input.to.length + (input.cc?.length || 0) + (input.bcc?.length || 0),
    })
    // §7 write gate: replying on an existing thread requires `full` lens.
    // New sends (placeholder / absent threadId) have no thread to gate on.
    await this.assertCanSendOnThread(
      this.isPlaceholderThreadId(input.threadId) ? null : (input.threadId ?? null)
    )
    // Validate input (capability-driven — subject/recipients depend on provider)
    const capabilities = await this.getCapabilitiesForIntegration(input.integrationId)
    this.validateInput(input, capabilities)
    // Usage guard: count outbound email before sending (skip for providers that
    // don't count, e.g. chat).
    if (capabilities.countsAgainstOutboundEmailsQuota) {
      const guard = await createUsageGuard(this.db ?? db)
      if (guard) {
        const usageResult = await guard.consume(input.organizationId, 'outboundEmails', {
          userId: input.userId,
        })
        if (!usageResult.allowed) {
          throw new UsageLimitError({
            metric: 'outboundEmails',
            current: usageResult.current ?? 0,
            limit: usageResult.limit ?? 0,
            message:
              'You have reached your monthly email sending limit. Upgrade your plan to send more emails.',
          })
        }
      }
    }
    let threadContext: ThreadContext | undefined
    // Hoisted so the catch can mark a freshly-composed-but-unsent row FAILED.
    let composed: ComposedMessage | undefined
    try {
      // Step 1: Prepare thread
      threadContext = await this.threadManager.getOrCreateThreadForSending({
        threadId: input.threadId,
        subject: input.subject,
        integrationId: input.integrationId,
        organizationId: input.organizationId,
      })
      logger.info('Thread context prepared', {
        threadId: threadContext.id,
        isPending: threadContext.isPending,
        externalId: threadContext.externalId,
      })
      // Step 2: Process participants
      const participants = await this.processParticipants(input)
      const isAutomatedSend = !this.viewer || isSystemViewer(this.viewer)
      // Step 2.4: §6 fix #3 — per-thread auto-reply alternation. Existing threads only;
      // a freshly-created (pending) thread has no prior message to alternate against.
      if (isAutomatedSend && !threadContext.isPending) {
        await this.assertAlternation(threadContext.id, input.organizationId)
      }
      // Step 2.5: Send-time suppression + List-Unsubscribe context (signals plan 02
      // "Send-time enforcement", decided 2026-07-13). No-op for non-email providers/chat
      // or when the primary recipient has no linked contact — cheap early-out before the
      // one indexed suppression read.
      const emailContext = this.resolveOutboundEmailContext({
        provider: capabilities.provider,
        participants,
      })
      if (emailContext && isAutomatedSend) {
        const suppressed = await isSuppressed(
          this.db ?? db,
          input.organizationId,
          emailContext.email
        )
        if (suppressed) {
          throw new ForbiddenError(
            `Recipient ${emailContext.email} is unsubscribed or bounced; automated send blocked`
          )
        }
      }
      // Step 2.6: §6 fix #4 — rate limit every automated send with a valid recipient
      // address, not only ones with a linked Contact. Hoisted out of the suppression
      // block: suppression + List-Unsubscribe are genuinely contact-scoped (they need
      // `emailContext`), but the rate limiter keys on a raw address and needs no contact
      // — the `entityInstanceId` requirement it inherited from that block was an accident
      // of nesting, not a decision, and left unlinked recipients with no rate limiting.
      const recipientAddress = this.resolveOutboundEmailAddress({
        provider: capabilities.provider,
        participants,
      })
      if (isAutomatedSend && recipientAddress) {
        // Rate limits for automated sends (machine-mail plan Phase 3) — per-recipient
        // cooldown + org circuit breaker. Defense-in-depth behind machine-mail detection.
        const rateLimit = await checkAutomatedSendLimits({
          organizationId: input.organizationId,
          recipientEmail: recipientAddress,
        })
        if (!rateLimit.allowed) {
          if (rateLimit.scope === 'org' && rateLimit.firstTrip) {
            await notifyAdminsOfSendBreakerTrip({
              organizationId: input.organizationId,
              limit: rateLimit.limit,
            })
          }
          throw new ForbiddenError(
            rateLimit.scope === 'recipient'
              ? `Automated send to ${recipientAddress} blocked: recipient received ` +
                  `${rateLimit.limit} automated emails in the last hour (possible loop)`
              : `Automated send blocked: organization exceeded ${rateLimit.limit} automated ` +
                  'emails in 15 minutes (circuit breaker tripped, admins notified)'
          )
        }
      }
      // Step 3: Compose message
      composed = await this.composer.composeMessage({
        threadId: threadContext.id,
        userId: input.userId,
        organizationId: input.organizationId,
        integrationId: input.integrationId,
        messageId: input.messageId, // Pass through provided Message-ID
        subject: input.subject,
        textHtml: input.textHtml,
        textPlain: input.textPlain,
        participants: participants,
        signatureId: input.signatureId,
        draftMessageId: input.draftMessageId,
        inReplyTo: await this.getInReplyTo(threadContext.id),
        references: await this.getReferences(threadContext.id),
        attachmentIds: input.attachmentIds, // Pass attachment IDs to composer
        isAutomatedSend, // §6 fix #3 — persisted for the per-thread alternation guard
      })
      logger.info('Message composed', {
        messageId: composed.id,
        sendToken: composed.sendToken,
        internetMessageId: composed.messageId,
      })
      // Step 4: Apply signature if needed
      let finalContent: { html?: string | null; plain?: string | null } = {
        html: composed.textHtml,
        plain: composed.textPlain,
      }
      if (input.signatureId) {
        finalContent = await this.composer.appendSignature(
          finalContent,
          input.signatureId,
          input.userId
        )
      }
      // Step 5: Prepare attachments for provider
      let attachmentFiles: AttachmentFile[] = []
      if (input.attachmentIds && input.attachmentIds.length > 0) {
        attachmentFiles = await this.prepareAttachments(input.attachmentIds)
      }
      // Step 5.5: List-Unsubscribe header — best-effort, never blocks the send. On by
      // default for automated sends; gated behind the org setting for human 1:1 replies.
      const unsubscribe = await this.buildUnsubscribeHeader({
        organizationId: input.organizationId,
        integrationId: input.integrationId,
        emailContext,
        automated: isAutomatedSend,
      })
      // Step 5.6: Email open/click tracking instrumentation (signals plan 02 "Open + click
      // tracking", Phase 2). ALL outbound email gets tracking, not just automated sends —
      // `isAutomatedSend` is unrelated. Best-effort — never blocks or fails the send.
      if (finalContent.html) {
        finalContent.html = await this.applyEmailTracking({
          organizationId: input.organizationId,
          integrationId: input.integrationId,
          messageId: composed.id,
          html: finalContent.html,
          emailContext,
          unsubscribeUrl: unsubscribe?.url,
        })
      }
      // Step 6: Send via provider
      const sendResult = await this.sendViaProvider({
        integrationId: input.integrationId,
        composed: composed,
        participants: participants,
        finalContent: finalContent,
        threadContext: threadContext,
        attachments: attachmentFiles,
        unsubscribe,
        automated: isAutomatedSend,
      })
      // Step 7: Reconcile with provider response. Per-message bookkeeping
      // (sendStatus, sentAt, externalId) always runs; the thread-level
      // reconciliation is gated on the capability — chat has no external
      // thread state and echoes our own id back, which would clobber thread
      // metadata if reconciled.
      await this.reconciler.reconcileSentMessage({
        messageId: composed.id,
        sendToken: composed.sendToken,
        providerResponse: sendResult,
        threadContext: threadContext,
        reconcileThread: capabilities.requiresSendReconciliation,
      })

      // A provider failure that does NOT throw lands here: the reconciler wrote
      // `sendStatus = FAILED` + the sanitized `providerError` and replaced
      // `metadata` wholesale, so the provider's own text has to be merged back
      // in afterwards or it is lost to log rotation.
      if (!sendResult.success) {
        await this.persistProviderErrorRaw(composed.id, sendResult.metadata?.providerErrorRaw)
      }

      // Realtime: publish `message:created` for the freshly sent message so
      // open tabs see the outbound row land without waiting for the post-send
      // sync re-import. The post-send sync emits `message:updated` later for
      // provider-authoritative columns — accepted duplicate.
      try {
        const [threadRow] = await (this.db ?? db)
          .select({ inboxId: schema.Thread.inboxId, assigneeId: schema.Thread.assigneeId })
          .from(schema.Thread)
          .where(eq(schema.Thread.id, threadContext.id))
          .limit(1)
        await publishMessageCreated(
          getRealtimeService(),
          this.organizationId,
          {
            messageId: composed.id,
            threadId: threadContext.id,
            inboxId: threadRow?.inboxId ?? null,
            assigneeId: threadRow?.assigneeId ?? null,
          },
          { excludeSocketId: this.socketId }
        )
      } catch (err) {
        logger.debug('Failed to publish message:created for outbound send (non-critical)', {
          err: err instanceof Error ? err.message : err,
        })
      }

      // Step 8: Update thread metadata
      await this.threadManager.updateThreadMetadata(threadContext.id)
      await this.threadManager.updateThreadParticipants(threadContext.id)
      // Outbound send is real activity on any linked entity (deal/ticket/lead).
      await touchActivityForThreadLinks(threadContext.id, this.organizationId)
      // Interaction stamp for Auxx-sent mail: this path never reaches ingest's
      // fresh-insert touch (the sync echo early-returns in storeMessage), so
      // without this the stamps only move when the customer writes. Successful
      // sends only — a FAILED row is not correspondence (§2.4).
      if (sendResult.success) {
        await touchInteractionForThreadLinks(
          threadContext.id,
          this.organizationId,
          composed.id,
          sendResult.timestamp ?? new Date()
        )
      }
      // Step 9: Trigger post-send sync (skip for providers without external
      // state to reconcile, e.g. chat).
      if (capabilities.triggersPostSendSync) {
        await this.triggerPostSendSync(input.integrationId, {
          messageId: composed.id,
          threadId: threadContext.id,
          sendToken: composed.sendToken,
        })
      }
      // Step 10: Convert temp attachments to permanent after successful send
      if (input.attachmentIds && input.attachmentIds.length > 0 && sendResult.success) {
        await this.convertAttachmentsToPermanent(input.attachmentIds)
      }
      // Step 11: Return result, carrying the resolved participants so the
      // client can render the optimistic row with correct from/to immediately.
      const sent = await this.getUpdatedMessage(composed.id)
      sent.participants = participants.all.map((p) => ({ id: p.id, role: p.role }))
      return sent
    } catch (error) {
      logger.error('Failed to send message', {
        error,
        input: {
          userId: input.userId,
          subject: input.subject,
          threadId: input.threadId,
        },
      })

      // Mark the composed-but-unsent row FAILED so it doesn't strand as PENDING
      // forever. The send runs synchronously in the request, so a throw between
      // row creation (Step 3) and reconciliation (Step 7) leaves a PENDING row
      // that retry rejects and the UI shows as a permanent "being sent" spinner.
      // Marking FAILED makes it retryable. (A hard process death can't run this
      // — the stale-PENDING sweeper covers that case.)
      if (composed?.id) {
        try {
          const { extractProviderErrorText } = await import('../providers/error-normalization')
          const raw = extractProviderErrorText(error)
          await (this.db ?? db)
            .update(schema.Message)
            .set({
              sendStatus: SendStatus.FAILED,
              providerError: error instanceof Error ? error.message : String(error),
              lastAttemptAt: new Date(),
              attempts: sql`${schema.Message.attempts} + 1`,
              updatedAt: new Date(),
              ...(raw ? { metadata: providerErrorRawMerge(raw) } : {}),
            })
            .where(eq(schema.Message.id, composed.id))
        } catch (markError) {
          logger.warn('Failed to mark message FAILED after send error', {
            messageId: composed.id,
            error: markError instanceof Error ? markError.message : String(markError),
          })
        }
      }

      // Clean up orphaned thread if we created a new one during this send attempt
      if (threadContext?.isPending) {
        try {
          await this.threadManager.deletePendingThread(threadContext.id)
          logger.info('Cleaned up orphaned pending thread after send failure', {
            threadId: threadContext.id,
          })
        } catch (cleanupError) {
          logger.warn('Failed to clean up orphaned pending thread', {
            threadId: threadContext.id,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          })
        }
      }

      throw error
    }
  }
  /**
   * Validates send message input against the provider's capabilities.
   * Subject / recipient checks are skipped for providers that don't require
   * them (e.g. chat).
   */
  private validateInput(
    input: SendMessageInput,
    capabilities: { requiresSubject: boolean; requiresRecipients: boolean }
  ): void {
    if (!input.userId) {
      throw new Error('User ID is required')
    }
    if (!input.organizationId) {
      throw new Error('Organization ID is required')
    }
    if (input.organizationId !== this.organizationId) {
      throw new Error('Organization mismatch')
    }
    if (!input.integrationId) {
      throw new Error('Integration ID is required')
    }
    if (capabilities.requiresSubject && !input.subject) {
      throw new Error('Subject is required')
    }
    if (capabilities.requiresRecipients && (!input.to || input.to.length === 0)) {
      throw new Error('At least one recipient is required')
    }
    if (!input.textHtml && !input.textPlain && !input.attachmentIds?.length) {
      throw new Error('Message content is required')
    }
  }
  /**
   * Resolves the capability matrix for an integration. Looks up the
   * integration's provider string and reads the static capability map.
   */
  private async getCapabilitiesForIntegration(integrationId: string): Promise<{
    provider: string
    requiresSubject: boolean
    requiresRecipients: boolean
    countsAgainstOutboundEmailsQuota: boolean
    triggersPostSendSync: boolean
    requiresSendReconciliation: boolean
  }> {
    const [integration] = await (this.db ?? db)
      .select({ provider: schema.Integration.provider })
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)
    if (!integration) {
      throw new Error(`Integration ${integrationId} not found`)
    }
    const { getProviderCapabilities } = await import('../providers/provider-capabilities')
    const caps = getProviderCapabilities(integration.provider as any)
    return {
      provider: integration.provider,
      requiresSubject: caps.requiresSubject,
      requiresRecipients: caps.requiresRecipients,
      countsAgainstOutboundEmailsQuota: caps.countsAgainstOutboundEmailsQuota,
      triggersPostSendSync: caps.triggersPostSendSync,
      requiresSendReconciliation: caps.requiresSendReconciliation,
    }
  }
  /**
   * Processes participants and ensures they exist in the database
   */
  private async processParticipants(input: SendMessageInput): Promise<ProcessedParticipants> {
    // FROM is the sending mailbox (e.g. markus@auxx.ai), not the operator's
    // login email — those can differ, and keying FROM off the user collapses it
    // onto a recipient when the operator's email matches a recipient. Providers
    // without a mailbox address (e.g. chat) fall back to the user identity.
    const fromParticipant =
      (await this.participantService.findOrCreateParticipantForIntegration(input.integrationId)) ??
      (await this.participantService.findOrCreateParticipantForUser(input.userId))
    if (!fromParticipant) {
      throw new Error(
        `Could not resolve FROM participant for integration ${input.integrationId} / user ${input.userId}`
      )
    }
    // Process recipients
    const processParticipant = async (p: (typeof input.to)[0], role: ParticipantRoleType) => {
      const participant = await this.participantService.findOrCreateParticipant(p)
      if (!participant) {
        throw new Error(`Could not create participant for ${p.identifier}`)
      }
      return {
        ...participant,
        role,
      } as ProcessedParticipant
    }
    // Process all recipients in parallel
    const [toParticipants, ccParticipants, bccParticipants] = await Promise.all([
      Promise.all(input.to.map((p) => processParticipant(p, ParticipantRole.TO))),
      Promise.all((input.cc || []).map((p) => processParticipant(p, ParticipantRole.CC))),
      Promise.all((input.bcc || []).map((p) => processParticipant(p, ParticipantRole.BCC))),
    ])
    // Combine all unique participants
    const allParticipants = [
      { ...fromParticipant, role: ParticipantRole.FROM } as ProcessedParticipant,
      ...toParticipants,
      ...ccParticipants,
      ...bccParticipants,
    ]
    return {
      from: { ...fromParticipant, role: ParticipantRole.FROM } as ProcessedParticipant,
      to: toParticipants,
      cc: ccParticipants.length > 0 ? ccParticipants : undefined,
      bcc: bccParticipants.length > 0 ? bccParticipants : undefined,
      all: allParticipants,
    }
  }
  /**
   * Resolves the primary recipient's raw email address for the §6 fix #4 rate limiter.
   * Returns `null` for non-email providers (chat/SMS/social DMs) or when the primary `to`
   * participant isn't an email identifier. Deliberately does NOT require a linked
   * Contact — the rate limiter keys on a raw address and needs no contact; that
   * requirement belongs to `resolveOutboundEmailContext` below (suppression +
   * List-Unsubscribe, which genuinely are contact-scoped).
   */
  private resolveOutboundEmailAddress(params: {
    provider: string
    participants: ProcessedParticipants
  }): string | null {
    if (!EMAIL_PROVIDER_TYPES.has(params.provider)) return null
    const primary = params.participants.to[0]
    if (!primary || primary.identifierType !== 'EMAIL') return null
    return primary.identifier
  }

  /**
   * Resolves the outbound-email context needed for send-time suppression + the
   * List-Unsubscribe header (signals plan 02). Returns `null` for non-email providers
   * (chat/SMS/social DMs), or when the primary `to` participant isn't an email identifier
   * linked to a CRM contact — both suppression and List-Unsubscribe are contact-scoped, so
   * there's nothing to check/build without one.
   */
  private resolveOutboundEmailContext(params: {
    provider: string
    participants: ProcessedParticipants
  }): { email: string; contactEntityInstanceId: string } | null {
    if (!EMAIL_PROVIDER_TYPES.has(params.provider)) return null
    const primary = params.participants.to[0]
    if (!primary || primary.identifierType !== 'EMAIL') return null
    if (!primary.entityInstanceId) return null
    return { email: primary.identifier, contactEntityInstanceId: primary.entityInstanceId }
  }

  /**
   * §6 fix #3 — per-thread auto-reply alternation. Never send an automated message
   * twice in a row on a thread without an intervening message from someone else
   * (inbound, or a human/agent-assisted outbound). A loop dies on the second hop
   * instead of drifting under a per-recipient/org cap.
   *
   * A durable DB read, not Redis — a Redis-only ledger would inherit the same
   * fail-open-when-Redis-is-down weakness this plan criticizes in the rate limiter.
   * Only called for automated sends on an existing (non-pending) thread; new threads
   * have no prior message and always pass by construction (no row found → return).
   */
  private async assertAlternation(threadId: string, organizationId: string): Promise<void> {
    const [lastMessage] = await (this.db ?? db)
      .select({
        isInbound: schema.Message.isInbound,
        isAutomatedSend: schema.Message.isAutomatedSend,
      })
      .from(schema.Message)
      .where(eq(schema.Message.threadId, threadId))
      .orderBy(desc(schema.Message.sentAt))
      .limit(1)
    if (!lastMessage) return
    if (!lastMessage.isInbound && lastMessage.isAutomatedSend) {
      logger.warn('Automated send blocked: alternation guard', {
        threadId,
        organizationId,
      })
      throw new ForbiddenError(
        'Automated send blocked: the previous message on this thread was also an ' +
          'automated send (alternation guard — a workflow, sequence, or agent must not ' +
          'reply twice in a row without an intervening message from someone else)'
      )
    }
  }

  /**
   * Builds the `{ url }` payload for the provider's List-Unsubscribe header. Best-effort —
   * any failure (token issuance, setting lookup) logs a warning and returns `undefined` so
   * the send proceeds without the header rather than failing outright.
   */
  private async buildUnsubscribeHeader(params: {
    organizationId: string
    integrationId: string
    emailContext: { email: string; contactEntityInstanceId: string } | null
    automated: boolean
  }): Promise<{ url: string } | undefined> {
    if (!params.emailContext) return undefined
    try {
      // Automated sends (workflow/scheduled/sequence) always carry the header; human 1:1
      // replies only do when the org has opted in (support threads shouldn't necessarily
      // carry an unsubscribe link).
      if (!params.automated) {
        const enabled = await getOrganizationSetting({
          organizationId: params.organizationId,
          key: 'email.unsubscribeOn1to1Replies',
        })
        if (!enabled) return undefined
      }
      const tokenResult = await issueUnsubscribeToken({
        organizationId: params.organizationId,
        contactEntityInstanceId: params.emailContext.contactEntityInstanceId,
        email: params.emailContext.email,
        channelId: params.integrationId,
      })
      if (!Result.isOk(tokenResult)) {
        logger.warn('Failed to issue unsubscribe token; sending without List-Unsubscribe header', {
          organizationId: params.organizationId,
          error: tokenResult.error.message,
        })
        return undefined
      }
      return { url: buildUnsubscribeUrl(tokenResult.value) }
    } catch (error) {
      logger.warn('Unsubscribe header build failed; sending without List-Unsubscribe header', {
        organizationId: params.organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }

  /**
   * Instruments outbound HTML with open/click tracking (signals plan 02, Phase 2). No-op
   * (returns `html` unchanged) when there's no linked contact — a signal with no contact is
   * worthless in v1 — or when the channel's provider type / tracking settings resolve to
   * both `opens` and `clicks` off. Reads channel settings + provider type off the org cache
   * (`channels`), never a fresh query. Best-effort: any failure (cache read, token issuance)
   * logs a warning and returns the original `html` so tracking can never block or fail a send.
   */
  private async applyEmailTracking(params: {
    organizationId: string
    integrationId: string
    messageId: string
    html: string
    emailContext: { email: string; contactEntityInstanceId: string } | null
    unsubscribeUrl?: string
  }): Promise<string> {
    if (!params.emailContext?.contactEntityInstanceId) return params.html
    try {
      const channels = await getOrgCache().get(params.organizationId, 'channels')
      const channel = channels.find((c) => c.id === params.integrationId)
      if (!channel) return params.html
      const providerType = channel.provider
      if (
        providerType !== IntegrationProviderType.google &&
        providerType !== IntegrationProviderType.outlook &&
        providerType !== IntegrationProviderType.email
      ) {
        return params.html
      }
      const opens = channel.settings?.tracking?.opens ?? true
      const clicks =
        channel.settings?.tracking?.clicks ?? providerType === IntegrationProviderType.email
      if (!opens && !clicks) return params.html
      return await instrumentEmailHtml({
        html: params.html,
        organizationId: params.organizationId,
        messageId: params.messageId,
        contactEntityInstanceId: params.emailContext.contactEntityInstanceId,
        channelId: params.integrationId,
        opens,
        clicks,
        skipUrls: params.unsubscribeUrl ? [params.unsubscribeUrl] : [],
      })
    } catch (error) {
      logger.warn('Email tracking instrumentation failed; sending untracked', {
        organizationId: params.organizationId,
        messageId: params.messageId,
        error: error instanceof Error ? error.message : String(error),
      })
      return params.html
    }
  }

  /**
   * Gets the In-Reply-To header for threading
   */
  private async getInReplyTo(threadId: string): Promise<string | null> {
    const rows = await db
      .select({ internetMessageId: schema.Message.internetMessageId })
      .from(schema.Message)
      .where(and(eq(schema.Message.threadId, threadId), sql`("internetMessageId" IS NOT NULL)`))
      .orderBy(desc(schema.Message.sentAt))
      .limit(1)
    return rows?.[0]?.internetMessageId ?? null
  }
  /**
   * Gets the References header for threading
   */
  private async getReferences(threadId: string): Promise<string | null> {
    const rows = await db
      .select({ internetMessageId: schema.Message.internetMessageId })
      .from(schema.Message)
      .where(and(eq(schema.Message.threadId, threadId), sql`("internetMessageId" IS NOT NULL)`))
      .orderBy(asc(schema.Message.sentAt))
      .limit(10)
    if (!rows || rows.length === 0) return null
    return rows
      .map((m) => m.internetMessageId)
      .filter(Boolean)
      .join(' ')
  }
  /**
   * Sends message via the appropriate provider
   */
  private async sendViaProvider(input: {
    integrationId: string
    composed: ComposedMessage
    participants: ProcessedParticipants
    finalContent: {
      html?: string | null
      plain?: string | null
    }
    threadContext: ThreadContext
    attachments?: AttachmentFile[]
    unsubscribe?: { url: string }
    automated?: boolean
  }): Promise<ProviderSendResponse> {
    if (!this.providerRegistry) {
      throw new Error('Provider registry not initialized')
    }
    // Get the provider
    const provider = await this.providerRegistry.getProvider(input.integrationId)
    if (!provider) {
      throw new Error(`Provider not found for integration ${input.integrationId}`)
    }
    logger.info('Sending message via provider', {
      integrationId: input.integrationId,
      providerType: (provider as any).type || 'unknown',
    })
    try {
      // Sanitize external thread ID before sending
      const sanitizedExternalThreadId = this.isPlaceholderThreadId(input.threadContext.externalId)
        ? undefined
        : input.threadContext.externalId
      // Call provider's sendMessage method
      const result: ProviderSendResult = await provider.sendMessage({
        messageId: input.composed.messageId,
        internalMessageId: input.composed.id,
        from: input.participants.from.identifier,
        to: input.participants.to.map((p) => p.identifier),
        cc: input.participants.cc?.map((p) => p.identifier),
        bcc: input.participants.bcc?.map((p) => p.identifier),
        subject: input.composed.subject,
        html: input.finalContent.html || undefined,
        text: input.finalContent.plain || undefined,
        references: input.composed.references || undefined,
        inReplyTo: input.composed.inReplyTo || undefined,
        externalThreadId: sanitizedExternalThreadId, // Use sanitized ID
        attachments: input.attachments, // Pass attachments to provider
        unsubscribe: input.unsubscribe, // List-Unsubscribe header (email providers only)
        automated: input.automated, // RFC 3834 loop-prevention headers (email providers only)
      } as any)
      return {
        success: result.success,
        messageId: result.id,
        threadId: result.threadId,
        historyId: result.historyId,
        labelIds: result.labelIds,
        timestamp: new Date(),
        metadata: result,
      }
    } catch (error: any) {
      // Import error normalizer
      const { ErrorNormalizer, NormalizedEmailError, extractProviderErrorText } = await import(
        '../providers/error-normalization'
      )
      // Determine provider type for normalization
      const providerType = (provider as any).getProviderName?.() || 'unknown'
      let normalizedError: NormalizedEmailErrorInstance
      // Check if already normalized
      if (error && typeof error === 'object' && error.name === 'NormalizedEmailError') {
        normalizedError = error
      } else if (providerType === 'google' || providerType === 'gmail') {
        normalizedError = ErrorNormalizer.normalizeGmailError(error)
      } else if (providerType === 'outlook' || providerType === 'microsoft') {
        normalizedError = ErrorNormalizer.normalizeOutlookError(error)
      } else {
        // Generic error
        normalizedError = new NormalizedEmailError(
          'UNKNOWN' as any,
          error.message || 'Unknown provider error',
          error,
          { provider: providerType }
        )
      }
      // Log structured error
      logger.error('Provider send failed', {
        code: normalizedError.code,
        message: normalizedError.message,
        provider: providerType,
        integrationId: input.integrationId,
        retryable: normalizedError.details?.retryable,
        hasAttachments: !!(input.attachments && input.attachments.length > 0),
        attachmentCount: input.attachments?.length || 0,
      })
      // Get user-friendly message
      const userMessage = ErrorNormalizer.getUserMessage(normalizedError)
      return {
        success: false,
        error: userMessage,
        timestamp: new Date(),
        // `ProviderSendResponse` carries only `error`, which is the sanitized
        // user-facing string. The structured code, retryability and the
        // provider's own error text ride along in `metadata`; the caller lifts
        // `providerErrorRaw` into `Message.metadata` after reconciliation.
        metadata: {
          errorCode: normalizedError.code,
          retryable: normalizedError.details?.retryable,
          providerErrorRaw: extractProviderErrorText(error),
        },
      }
    }
  }
  /**
   * Merges the provider's own error text into `Message.metadata.providerErrorRaw`.
   * Best-effort — a failure here must never mask the send failure it describes.
   */
  private async persistProviderErrorRaw(messageId: string, raw: unknown): Promise<void> {
    if (typeof raw !== 'string' || !raw) return
    try {
      await (this.db ?? db)
        .update(schema.Message)
        .set({ metadata: providerErrorRawMerge(raw) })
        .where(eq(schema.Message.id, messageId))
    } catch (error) {
      logger.warn('Failed to persist raw provider error', {
        messageId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  /**
   * Triggers immediate sync after sending
   * This ensures we get both SENT and INBOX copies for self-sent messages
   */
  private async triggerPostSendSync(
    integrationId: string,
    metadata: {
      messageId: string
      threadId: string
      sendToken: string
    }
  ): Promise<void> {
    const job: PostSendSyncJob = {
      integrationId,
      type: 'POST_SEND_SYNC',
      priority: 'HIGH',
      delay: 2000, // 2 second delay to ensure provider has processed
      metadata,
    }
    // Queue the sync job via Redis
    const redis = await getRedisClient(false)
    if (redis) {
      const jobData = JSON.stringify(job)
      await redis.lpush?.('sync:high-priority', jobData)
      await redis.expire?.('sync:high-priority', 3600) // 1 hour TTL
      logger.info('Queued post-send sync job', {
        integrationId,
        messageId: metadata.messageId,
      })
    } else {
      logger.warn('Redis not available for post-send sync', {
        integrationId,
      })
    }
  }
  /**
   * Gets the updated message after sending
   */
  private async getUpdatedMessage(messageId: string): Promise<SentMessage> {
    const [message] = await db
      .select({
        id: schema.Message.id,
        externalId: schema.Message.externalId,
        threadId: schema.Message.threadId,
        subject: schema.Message.subject,
        sendStatus: schema.Message.sendStatus,
        sentAt: schema.Message.sentAt,
        providerError: schema.Message.providerError,
      })
      .from(schema.Message)
      .where(eq(schema.Message.id, messageId))
      .limit(1)
    if (!message) {
      throw new Error(`Message ${messageId} not found`)
    }
    return {
      id: message.id,
      // Both columns are nullable in the schema but always populated on the send
      // path (`createPendingMessage` writes a `pending_<token>` externalId and a
      // subject); `SentMessage` declares them non-null.
      externalId: message.externalId ?? '',
      threadId: message.threadId,
      subject: message.subject ?? '',
      sendStatus: message.sendStatus || 'PENDING',
      sentAt: message.sentAt,
      error: message.providerError,
    }
  }
  /**
   * Checks if we can send messages for an integration.
   *
   * NOTE: currently has no callers anywhere in `packages/` or `apps/`.
   *
   * `Integration.settings` was dropped in migration 0028; integration settings
   * now live under `Integration.metadata.settings` (same read as
   * `google-provider.ts#initialize`). The gate is deliberately fail-open — an
   * integration with no settings blob can send.
   */
  async canSendMessages(integrationId: string): Promise<boolean> {
    const [integration] = await db
      .select({
        id: schema.Integration.id,
        provider: schema.Integration.provider,
        metadata: schema.Integration.metadata,
      })
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)
    if (!integration) return false
    // Check if integration is configured for sending
    const settings = (integration.metadata as { settings?: { canSend?: boolean } } | null)?.settings
    return settings?.canSend !== false
  }
  /**
   * Prepares attachments for sending by converting MediaAsset IDs to AttachmentFile format
   */
  private async prepareAttachments(ids: string[]): Promise<AttachmentFile[]> {
    const attachments: AttachmentFile[] = []
    for (const id of ids) {
      try {
        // Try as MediaAsset first
        const [asset] = await db
          .select({ id: schema.MediaAsset.id })
          .from(schema.MediaAsset)
          .where(
            and(
              eq(schema.MediaAsset.id, id),
              eq(schema.MediaAsset.organizationId, this.organizationId)
            )
          )
          .limit(1)
        if (asset) {
          const assetWith = await this.mediaAssetService.getWithRelations(id)
          if (!assetWith) {
            logger.warn(`MediaAsset ${id} not found (post-lookup), skipping`)
            continue
          }
          const content = await this.mediaAssetService.getContent(id)
          attachments.push({
            filename: assetWith.name || 'attachment',
            content,
            contentType: assetWith.mimeType || 'application/octet-stream',
            size: Number(assetWith.size || 0),
            id,
          })
          continue
        }
        // Try as FolderFile
        const [file] = await db
          .select({ id: schema.FolderFile.id })
          .from(schema.FolderFile)
          .where(
            and(
              eq(schema.FolderFile.id, id),
              eq(schema.FolderFile.organizationId, this.organizationId)
            )
          )
          .limit(1)
        if (file) {
          const fileWith = await this.fileService.getWithRelations(id)
          if (!fileWith) {
            logger.warn(`FolderFile ${id} not found (post-lookup), skipping`)
            continue
          }
          const content = await this.fileService.getContent(id)
          const mimeType =
            (fileWith.currentVersion as any)?.mimeType ||
            fileWith.mimeType ||
            'application/octet-stream'
          const size = Number((fileWith.currentVersion as any)?.size || fileWith.size || 0)
          attachments.push({
            filename: fileWith.name || 'attachment',
            content,
            contentType: mimeType,
            size,
            id,
          })
          continue
        }
        // Not found in either table
        logger.warn(`Attachment ID ${id} not found in asset or file tables; skipping`)
      } catch (error) {
        logger.error(`Failed to prepare attachment ${id}`, error)
        // Continue with other attachments
      }
    }
    // Enhanced size validation with detailed error messages
    const MAX_TOTAL_SIZE = 25 * 1024 * 1024 // 25MB
    const MAX_SINGLE_SIZE = 25 * 1024 * 1024 // 25MB per file
    const BASE64_OVERHEAD = 1.37 // 37% overhead for base64 encoding
    // Check individual file sizes
    for (const attachment of attachments) {
      const fileSize = attachment.size || 0
      const encodedSize = Math.ceil(fileSize * BASE64_OVERHEAD)
      if (encodedSize > MAX_SINGLE_SIZE) {
        const { NormalizedEmailError, EmailErrorCode } = await import(
          '../providers/error-normalization'
        )
        throw new NormalizedEmailError(
          EmailErrorCode.ATTACHMENT_TOO_LARGE,
          `Attachment "${attachment.filename}" is too large. ` +
            `Size: ${(fileSize / 1024 / 1024).toFixed(2)}MB, ` +
            `Encoded: ${(encodedSize / 1024 / 1024).toFixed(2)}MB, ` +
            `Max: ${(MAX_SINGLE_SIZE / 1024 / 1024).toFixed(0)}MB`,
          undefined,
          { filename: attachment.filename, size: fileSize, limit: MAX_SINGLE_SIZE }
        )
      }
    }
    // Check total size
    const totalSize = attachments.reduce((sum, att) => sum + (att.size || 0), 0)
    const totalEncodedSize = Math.ceil(totalSize * BASE64_OVERHEAD)
    if (totalEncodedSize > MAX_TOTAL_SIZE) {
      const { NormalizedEmailError, EmailErrorCode } = await import(
        '../providers/error-normalization'
      )
      throw new NormalizedEmailError(
        EmailErrorCode.SIZE_LIMIT_EXCEEDED,
        `Total attachment size exceeds limit. ` +
          `Total: ${(totalSize / 1024 / 1024).toFixed(2)}MB, ` +
          `Encoded: ${(totalEncodedSize / 1024 / 1024).toFixed(2)}MB, ` +
          `Max: ${(MAX_TOTAL_SIZE / 1024 / 1024).toFixed(0)}MB`,
        undefined,
        { size: totalSize, limit: MAX_TOTAL_SIZE }
      )
    }
    logger.info('Attachment size validation passed', {
      fileCount: attachments.length,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      encodedSizeMB: (totalEncodedSize / 1024 / 1024).toFixed(2),
    })
    return attachments
  }
  /**
   * Converts temporary attachments to permanent after successful send
   */
  private async convertAttachmentsToPermanent(ids: string[]): Promise<void> {
    // Idempotent, type-aware: convert MediaAssets if needed; ignore FolderFiles
    for (const id of ids) {
      try {
        const [asset] = await db
          .select({ id: schema.MediaAsset.id, kind: schema.MediaAsset.kind })
          .from(schema.MediaAsset)
          .where(
            and(
              eq(schema.MediaAsset.id, id),
              eq(schema.MediaAsset.organizationId, this.organizationId)
            )
          )
          .limit(1)
        if (asset) {
          // If already EMAIL_ATTACHMENT, this is a no-op; if temp, set to permanent
          await this.mediaAssetService.update(id, {
            kind: 'EMAIL_ATTACHMENT',
            expiresAt: null,
          } as any)
          logger.info(`Ensured MediaAsset ${id} is permanent EMAIL_ATTACHMENT`)
          continue
        }
        // If it's a FolderFile, nothing to do
        const [file] = await db
          .select({ id: schema.FolderFile.id })
          .from(schema.FolderFile)
          .where(
            and(
              eq(schema.FolderFile.id, id),
              eq(schema.FolderFile.organizationId, this.organizationId)
            )
          )
          .limit(1)
        if (file) {
          logger.info(`FolderFile ${id} needs no conversion; skipping`)
          continue
        }
        logger.warn(`Attachment ID ${id} not found during conversion`)
      } catch (error) {
        logger.error(`Failed to ensure attachment ${id} permanent state`, error)
        // Continue processing other IDs
      }
    }
  }
  /**
   * Retries sending a failed message
   * - Validates the message exists and is in failed state
   * - Resets status and increments attempt counter
   * - Reuses existing message composition
   * - Sends via provider with existing content
   */
  async retryFailedMessage(input: RetryMessageInput): Promise<RetryMessageResult> {
    logger.info('Starting message retry', {
      messageId: input.messageId,
      userId: input.userId,
      organizationId: input.organizationId,
    })
    try {
      // 1. Load the failed message with all relations
      const failedMessage = await this.loadFailedMessage(input.messageId)
      // 2. Validate retry eligibility (+ §7 send gate on the parent thread)
      this.validateRetryEligibility(failedMessage, input.organizationId)
      await this.assertCanSendOnThread(failedMessage.threadId ?? null)
      // 3. Reset message status and get attempt number
      const attemptNumber = await this.resetMessageForRetry(input.messageId)
      // 4. Extract send parameters from existing message
      const sendParams = await this.extractRetryParameters(failedMessage)
      // 5. Send directly via provider (skip composition)
      const result = await this.retrySendViaProvider(sendParams)
      // 6. Run the same post-send tail a first-time send runs
      return await this.finalizeRetry(failedMessage, result, attemptNumber)
    } catch (error) {
      logger.error('Failed to retry message', {
        messageId: input.messageId,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
  }
  /**
   * Loads a message with all necessary relations for retry
   */
  private async loadFailedMessage(messageId: string) {
    const row = await db.query.Message.findFirst({
      where: (t, { eq }) => eq(t.id, messageId),
      with: {
        thread: true,
        participants: {
          with: { participant: true },
          orderBy: [asc(schema.MessageParticipant.role)],
        },
        // NOTE: no `signature` relation here. `Message.signatureId` points at an
        // `EntityInstance` now, and the old `Message.signature` relation was
        // removed with the `Signature` table (see
        // `database/src/db/relations/messaging.ts`). Naming a relation Drizzle
        // does not have throws `Cannot read properties of undefined (reading
        // 'referencedTable')` and takes down retry for every provider.
        from: true,
      },
    })
    if (!row) {
      throw new Error(`Message ${messageId} not found`)
    }

    // Load canonical attachments separately
    const attachments = await db
      .select({
        id: schema.Attachment.id,
        assetId: schema.Attachment.assetId,
        assetVersionId: schema.Attachment.assetVersionId,
        title: schema.Attachment.title,
        role: schema.Attachment.role,
        sort: schema.Attachment.sort,
      })
      .from(schema.Attachment)
      .where(
        and(
          eq(schema.Attachment.entityType, 'MESSAGE'),
          eq(schema.Attachment.entityId, messageId),
          eq(schema.Attachment.organizationId, row.organizationId)
        )
      )
      .orderBy(asc(schema.Attachment.sort))

    // Load media assets for attachments that have assetIds
    const assetIds = attachments.map((a) => a.assetId).filter(Boolean) as string[]
    const assetMap = new Map<string, any>()
    if (assetIds.length > 0) {
      const assets = await db.query.MediaAsset.findMany({
        where: (t, { inArray }) => inArray(t.id, assetIds),
      })
      for (const asset of assets) {
        assetMap.set(asset.id, asset)
      }
    }

    const attachmentsWithAssets = attachments.map((a) => ({
      ...a,
      mediaAssetId: a.assetId,
      mediaAsset: a.assetId ? (assetMap.get(a.assetId) ?? null) : null,
    }))

    return { ...row, attachments: attachmentsWithAssets }
  }
  /**
   * Validates that a message is eligible for retry
   */
  private validateRetryEligibility(message: any, organizationId: string): void {
    // Check organization access
    if (message.thread.organizationId !== organizationId) {
      throw new Error('Unauthorized: Message belongs to different organization')
    }
    // Check status
    if (message.sendStatus !== ('FAILED' as any)) {
      throw new Error(
        `Cannot retry message in ${message.sendStatus} status. Only FAILED messages can be retried.`
      )
    }
    // Check retry limit
    const MAX_RETRY_ATTEMPTS = 5
    if (message.attempts >= MAX_RETRY_ATTEMPTS) {
      throw new Error(`Maximum retry attempts (${MAX_RETRY_ATTEMPTS}) exceeded`)
    }
  }
  /**
   * Resets message status for retry and returns the new attempt number
   */
  private async resetMessageForRetry(messageId: string): Promise<number> {
    const [updated] = await db
      .update(schema.Message)
      .set({
        sendStatus: 'PENDING' as any,
        attempts: sql`${schema.Message.attempts} + 1`,
        lastAttemptAt: new Date(),
        providerError: null,
      })
      .where(eq(schema.Message.id, messageId))
      .returning({ attempts: schema.Message.attempts })

    if (!updated) throw new Error('unable to update message')

    logger.info('Message reset for retry', {
      messageId,
      attemptNumber: updated.attempts,
    })
    return updated.attempts
  }
  /**
   * Extracts send parameters from an existing message for retry
   */
  private async extractRetryParameters(message: any) {
    // Extract participants grouped by role
    const participants = this.extractParticipantsFromMessage(message)
    // Extract attachments if any
    const attachments = await this.extractAttachmentsFromMessage(message)
    return {
      messageId: message.id,
      threadId: message.threadId,
      integrationId: message.thread.integrationId,
      internetMessageId: message.messageId, // Preserve original Message-ID
      subject: message.subject || '',
      textHtml: message.textHtml,
      textPlain: message.textPlain,
      participants,
      attachments,
      references: message.references,
      inReplyTo: message.inReplyTo,
      threadContext: {
        id: message.threadId,
        externalId: message.thread.externalId,
        isPending: false,
      },
    }
  }
  /**
   * Extracts participants from a message grouped by role
   */
  private extractParticipantsFromMessage(message: any): ProcessedParticipants {
    const from = message.from
    const to: ProcessedParticipant[] = []
    const cc: ProcessedParticipant[] = []
    const bcc: ProcessedParticipant[] = []
    for (const mp of message.participants) {
      // `initials` is on the `Participant` row but not on `ProcessedParticipant`
      // — nothing on the send path reads it, so it is not carried through.
      const participant: ProcessedParticipant = {
        id: mp.participant.id,
        identifier: mp.participant.identifier,
        identifierType: mp.participant.identifierType,
        name: mp.participant.name,
        displayName: mp.participant.displayName,
        // The linked CRM contact is `Participant.entityInstanceId`; there is no
        // `contactId` column, so the old key read `undefined` and dropped it.
        entityInstanceId: mp.participant.entityInstanceId,
        role: mp.role,
      }
      switch (mp.role) {
        case ParticipantRole.TO:
          to.push(participant)
          break
        case ParticipantRole.CC:
          cc.push(participant)
          break
        case ParticipantRole.BCC:
          bcc.push(participant)
          break
      }
    }
    return { from, to, cc, bcc, all: [from, ...to, ...cc, ...bcc] }
  }
  /**
   * Extracts attachments from a message for retry
   */
  private async extractAttachmentsFromMessage(message: any): Promise<AttachmentFile[]> {
    const attachments: AttachmentFile[] = []
    for (const attachment of message.attachments) {
      if (!attachment.mediaAssetId || !attachment.mediaAsset) continue
      try {
        const asset = attachment.mediaAsset
        const content = await this.mediaAssetService.getContent(asset.id)
        if (!content) {
          logger.warn(`Attachment ${asset.id} has no content, skipping`)
          continue
        }
        attachments.push({
          filename: asset.fileName,
          content: content,
          contentType: asset.mimeType || 'application/octet-stream',
          size: Number(asset.size),
          id: asset.id,
        })
      } catch (error) {
        logger.error(`Failed to extract attachment ${attachment.mediaAssetId} for retry`, error)
        // Continue with other attachments
      }
    }
    return attachments
  }
  /**
   * Sends a retry message via provider with special handling
   */
  private async retrySendViaProvider(params: any): Promise<ProviderSendResponse> {
    if (!this.providerRegistry) {
      throw new Error('Provider registry not initialized')
    }
    const provider = await this.providerRegistry.getProvider(params.integrationId)
    if (!provider) {
      throw new Error(`Provider not found for integration ${params.integrationId}`)
    }
    logger.info('Retrying message send via provider', {
      messageId: params.messageId,
      integrationId: params.integrationId,
      attemptNumber: params.attemptNumber,
    })
    try {
      // Sanitize external thread ID
      const sanitizedExternalThreadId = this.isPlaceholderThreadId(params.threadContext.externalId)
        ? undefined
        : params.threadContext.externalId
      const result: ProviderSendResult = await provider.sendMessage({
        messageId: params.internetMessageId, // Use original Message-ID
        // Same `Message` row as the original attempt, so a retried Outlook send still
        // carries `X-AuxxAi-Message-Id` and its Sent Items copy reconciles onto this
        // row instead of duplicating into a forked thread.
        internalMessageId: params.messageId,
        from: params.participants.from.identifier,
        to: params.participants.to.map((p: any) => p.identifier),
        cc: params.participants.cc?.map((p: any) => p.identifier),
        bcc: params.participants.bcc?.map((p: any) => p.identifier),
        subject: params.subject,
        html: params.textHtml || undefined,
        text: params.textPlain || undefined,
        references: params.references || undefined,
        inReplyTo: params.inReplyTo || undefined,
        externalThreadId: sanitizedExternalThreadId,
        attachments: params.attachments,
      } as any)
      return {
        success: result.success,
        messageId: result.id,
        threadId: result.threadId,
        historyId: result.historyId,
        labelIds: result.labelIds,
        timestamp: new Date(),
        metadata: result,
      }
    } catch (error: any) {
      // Use existing error normalization
      const { ErrorNormalizer, NormalizedEmailError, extractProviderErrorText } = await import(
        '../providers/error-normalization'
      )
      const providerType = (provider as any).getProviderName?.() || 'unknown'
      let normalizedError: NormalizedEmailErrorInstance
      if (error && typeof error === 'object' && error.name === 'NormalizedEmailError') {
        normalizedError = error
      } else if (providerType === 'google' || providerType === 'gmail') {
        normalizedError = ErrorNormalizer.normalizeGmailError(error)
      } else if (providerType === 'outlook' || providerType === 'microsoft') {
        normalizedError = ErrorNormalizer.normalizeOutlookError(error)
      } else {
        normalizedError = new NormalizedEmailError(
          'UNKNOWN' as any,
          error.message || 'Unknown provider error',
          error,
          { provider: providerType }
        )
      }
      logger.error('Provider retry failed', {
        code: normalizedError.code,
        message: normalizedError.message,
        provider: providerType,
        messageId: params.messageId,
      })
      // Don't throw and don't write the row here — returning a failure response
      // lets `finalizeRetry` put it through the reconciler, which is the single
      // writer of `sendStatus`/`providerError` on every other send path.
      return {
        success: false,
        error: normalizedError.message,
        timestamp: new Date(),
        metadata: { error: normalizedError, providerErrorRaw: extractProviderErrorText(error) },
      }
    }
  }
  /**
   * Runs the post-send tail for a retry attempt.
   *
   * A retry is a second run of the *same* send, so it goes through the same
   * infrastructure `sendMessage` uses rather than hand-writing message rows:
   * the reconciler owns `sendStatus`/`sentAt`/`externalId`/`lastAttemptAt`,
   * thread counters get recomputed, and a `message:updated` goes out so open
   * tabs reflect the result without a reload.
   */
  private async finalizeRetry(
    failedMessage: any,
    result: ProviderSendResponse,
    attemptNumber: number
  ): Promise<RetryMessageResult> {
    const messageId = failedMessage.id as string
    const threadId = failedMessage.threadId as string
    const integrationId = failedMessage.integrationId as string
    const capabilities = await this.getCapabilitiesForIntegration(integrationId)

    // Step 7 equivalent: per-message bookkeeping, thread reconciliation gated on
    // the provider having external thread state to reconcile against.
    await this.reconciler.reconcileSentMessage({
      messageId,
      sendToken: failedMessage.sendToken ?? '',
      providerResponse: result,
      threadContext: {
        id: threadId,
        organizationId: this.organizationId,
        integrationId,
        externalId: failedMessage.thread?.externalId ?? null,
        isPending: false,
      },
      reconcileThread: capabilities.requiresSendReconciliation,
    })

    // The reconciler replaces `metadata` wholesale, so the provider's own text
    // has to be merged back in afterwards or it is lost (same as Step 7).
    if (!result.success) {
      await this.persistProviderErrorRaw(messageId, result.metadata?.providerErrorRaw)
    }

    // Step 8 equivalent. Thread counters are derived from `MAX(sentAt)`, so a
    // retry that finally lands has to recompute them — otherwise the thread
    // keeps `lastMessageAt = NULL` and renders as "0 seconds" forever.
    await this.threadManager.updateThreadMetadata(threadId)
    await this.threadManager.updateThreadParticipants(threadId)
    await touchActivityForThreadLinks(threadId, this.organizationId)
    // Interaction stamp — same rationale as the first-send path: Auxx-sent mail
    // never reaches ingest's touch, and only a landed retry is correspondence.
    if (result.success) {
      await touchInteractionForThreadLinks(
        threadId,
        this.organizationId,
        messageId,
        result.timestamp ?? new Date()
      )
    }

    const message = await this.getUpdatedMessage(messageId)

    // Realtime: the row already exists client-side, so this is an update rather
    // than the `message:created` a first-time send publishes.
    try {
      const [threadRow] = await (this.db ?? db)
        .select({ inboxId: schema.Thread.inboxId, assigneeId: schema.Thread.assigneeId })
        .from(schema.Thread)
        .where(eq(schema.Thread.id, threadId))
        .limit(1)
      await publishMessageUpdated(
        getRealtimeService(),
        this.organizationId,
        {
          messageId,
          threadId,
          inboxId: threadRow?.inboxId ?? null,
          assigneeId: threadRow?.assigneeId ?? null,
          patch: {
            sendStatus: message.sendStatus,
            providerError: message.providerError ?? null,
            sentAt: message.sentAt ? new Date(message.sentAt).toISOString() : null,
            attempts: attemptNumber,
          },
        },
        { excludeSocketId: this.socketId }
      )
    } catch (err) {
      logger.debug('Failed to publish message:updated for retry (non-critical)', {
        err: err instanceof Error ? err.message : err,
      })
    }

    // Step 9 equivalent — only meaningful once the provider actually accepted it.
    if (result.success && capabilities.triggersPostSendSync) {
      await this.triggerPostSendSync(integrationId, {
        messageId,
        threadId,
        sendToken: failedMessage.sendToken ?? '',
      })
    }

    logger.info('Message retry finalized', {
      messageId,
      attemptNumber,
      success: result.success,
    })

    return {
      success: result.success,
      message,
      attemptNumber,
      error: result.success ? undefined : (result.error ?? 'Failed to send message via provider'),
    }
  }
}
