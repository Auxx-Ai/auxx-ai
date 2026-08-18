// packages/lib/src/providers/openphone/openphone-provider.ts
// The Quo (formerly OpenPhone) SMS channel provider.
//
// Every network call goes through `./api` (base `https://api.quo.com/v1`). The old
// `https://api.openphone.co/v3` host this file used to point at does not resolve at all, so the
// hand-rolled `apiCall` it carried is gone — there is exactly one wire seam now.
//
// The provider key stays `openphone` everywhere it is persisted (IntegrationProviderType,
// Credential.type, Integration.provider, /api/openphone/webhook). This is a labels-only rename.

import { mergeSecretFields, revealSecrets } from '@auxx/credentials/store'
import { database as db, schema } from '@auxx/database'
import { IdentifierType as IdentifierTypeEnum, IntegrationProviderType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import {
  type IntegrationSettings, // Per-integration record-creation/filter settings
  type MessageData,
  MessageStorageService,
  type ParticipantInputData,
} from '../../email/email-storage'
import type {
  ChannelProvider,
  MessageStatus, // Note: Most statuses don't map directly to Quo
  SendMessageOptions,
} from '../channel-provider.interface'
import { BaseMessageProvider, type MessageProvider } from '../message-provider-interface'
import { getProviderCapabilities, type ProviderCapabilities } from '../provider-capabilities'
import {
  createMessageWebhook,
  deleteWebhook,
  listConversations,
  listMessages,
  QuoApiError,
  sendMessage as sendQuoMessage,
} from './api'
import type { OpenPhoneIntegrationMetadata, QuoConversation, QuoRestMessage } from './types'

const logger = createScopedLogger('openphone-provider')

/** `POST /v1/messages` accepts 1–10 recipients. More than that is truncated, loudly. */
const MAX_RECIPIENTS_PER_MESSAGE = 10

/** `maxResults` caps at 50 on both list endpoints — there is no larger page size. */
const CONVERSATION_PAGE_SIZE = 50
const MESSAGE_PAGE_SIZE = 50

/**
 * Cap on how many conversations one channel (one number) backfills. Per channel, not per
 * workspace: a shared cap would starve low-traffic numbers. Overridable per channel via
 * `Integration.metadata.backfillConversationLimit`.
 */
const DEFAULT_BACKFILL_CONVERSATION_LIMIT = 2000

/**
 * Bound on the per-conversation message walk. One call covers a conversation up to 50 messages;
 * this caps the pathological long-running thread at 500 rather than letting a single
 * conversation dominate the run.
 */
const MAX_MESSAGE_PAGES_PER_CONVERSATION = 10

/**
 * The expanding window used to bound enumeration (plan §6.2). `null` means "no lower bound".
 * Successive windows are enumerated as *rings* (`updatedAfter=w[i]` AND `updatedBefore=w[i-1]`),
 * so each conversation is fetched exactly once no matter how many windows we walk.
 */
const BACKFILL_WINDOW_MONTHS: Array<number | null> = [1, 3, 6, 12, 24, null]

/** Persist backfill progress every N conversations — 80 writes for a 2,000-conversation run. */
const BACKFILL_PROGRESS_WRITE_EVERY = 25

/**
 * REST never returns media — not on the list endpoint, not on `GET /v1/messages/{id}`. A
 * media-only MMS backfills as `text: ""` with *nothing* indicating an attachment ever existed,
 * so the placeholder can only be generic. Ingesting those silently as empty renders blank
 * bubbles that are indistinguishable from a bug, which is the worse option.
 */
const MEDIA_PLACEHOLDER = '[media — not available via backfill]'

/**
 * Resumable backfill state, stored on `Integration.metadata.backfill`.
 *
 * Deliberately small: the pinned `windowStart` plus a cursor, not the 2,000-entry conversation
 * list. Resuming re-enumerates the SAME window (bounded, ~80 requests) and re-sorts, then
 * resumes after `lastConversationId`. A conversation whose activity bumps mid-run may be
 * re-fetched (harmless — `storeMessage` dedupes on `externalId`) or, if it jumps ahead of the
 * cursor, skipped — but a bump means a live webhook already delivered that message.
 */
interface QuoBackfillState {
  startedAt: string
  /** ISO `updatedAfter` bound of the chosen window; `null` = no lower bound (all history). */
  windowStart: string | null
  completedConversations: number
  lastConversationId?: string | null
  completedAt?: string | null
}

interface QuoIntegrationMetadata extends OpenPhoneIntegrationMetadata {
  settings?: IntegrationSettings
  backfill?: QuoBackfillState
  backfillConversationLimit?: number
  backfillCutoffAt?: string
  initialBackfillCompletedAt?: string
}

function monthsAgoIso(months: number): string {
  const date = new Date()
  date.setMonth(date.getMonth() - months)
  return date.toISOString()
}

export class OpenPhoneProvider
  extends BaseMessageProvider
  implements ChannelProvider, MessageProvider
{
  private metadata: QuoIntegrationMetadata | null = null
  private apiKey: string | null = null
  private credentialId: string | null = null
  private phoneNumberId: string | null = null
  private phoneNumber: string | null = null // E.164
  private storageService: MessageStorageService

  constructor(organizationId: string) {
    super(IntegrationProviderType.openphone, '', organizationId)
    this.storageService = new MessageStorageService(organizationId)
  }

  /** Get provider capabilities for Quo. */
  getCapabilities(): ProviderCapabilities {
    return getProviderCapabilities(IntegrationProviderType.openphone)
  }

  /** Initializes the provider with data from the integration record. */
  async initialize(integrationId: string): Promise<void> {
    logger.info(`Initializing OpenPhoneProvider for integration: ${integrationId}`)
    this.integrationId = integrationId
    const [integration] = await db
      .select()
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.id, integrationId),
          eq(schema.Integration.organizationId, this.organizationId)
        )
      )
      .limit(1)
    if (
      !integration ||
      integration.provider !== 'openphone' ||
      !integration.enabled ||
      !integration.metadata
    ) {
      this.resetState()
      throw new Error(
        `Active Quo integration not found, not enabled, or missing metadata for ID: ${integrationId}`
      )
    }
    // The apiKey lives on the linked Credential's multi-field secret bag (`secrets.fields`), not
    // on `accessToken` — read it through the store rather than getChannelTokens.
    if (!integration.credentialId) {
      this.resetState()
      throw new Error(`Missing credential for Quo integration ID: ${integrationId}`)
    }
    const revealed = await revealSecrets<{ fields?: Record<string, string> }>(
      integration.credentialId,
      this.organizationId
    )
    const apiKey = revealed.isOk() ? revealed.value.secrets.fields?.apiKey : undefined
    if (!apiKey) {
      this.resetState()
      throw new Error(`Missing API key for Quo integration ID: ${integrationId}`)
    }
    this.apiKey = apiKey
    this.credentialId = integration.credentialId

    const metadata = integration.metadata as unknown as QuoIntegrationMetadata
    this.metadata = metadata
    this.phoneNumberId = metadata.phoneNumberId
    this.phoneNumber = metadata.phoneNumber
    if (!this.phoneNumberId || !this.phoneNumber) {
      this.resetState()
      logger.error('Quo integration metadata is missing phoneNumberId / phoneNumber', {
        integrationId,
      })
      throw new Error(`Invalid metadata format for Quo integration ${integrationId}`)
    }

    // Channel settings live under `Integration.metadata.settings`.
    if (metadata.settings) {
      this.storageService.setIntegrationSettings(metadata.settings)
    }

    // The "us" identity for a phone channel is its own number — the analogue of
    // `Integration.email` on a mailbox. Without this the classifier stores our
    // own number as an external participant, and since Quo channels provision
    // with `recordCreation.mode: 'all'`, ingest would mint a Contact record for
    // the org's own support line off the first message either direction.
    this.storageService.setOwnIdentities({ [IdentifierTypeEnum.PHONE]: [this.phoneNumber] })

    // Received-time trigger cutoff: while the initial backfill is incomplete, ingest suppresses
    // `message:received` for messages received before the connect epoch. The stamp itself is
    // written by the provisioning hook; this is the consumption side.
    this.storageService.setBackfillCutoff(
      metadata.backfillCutoffAt && !metadata.initialBackfillCompletedAt
        ? new Date(metadata.backfillCutoffAt)
        : null
    )

    logger.info(
      `OpenPhoneProvider initialized successfully for Number: ${this.phoneNumber} (ID: ${this.phoneNumberId})`,
      { integrationId }
    )
  }

  private resetState(): void {
    this.integrationId = null
    this.metadata = null
    this.apiKey = null
    this.credentialId = null
    this.phoneNumberId = null
    this.phoneNumber = null
  }

  private async ensureInitialized(): Promise<void> {
    if (
      !this.integrationId ||
      !this.apiKey ||
      !this.phoneNumberId ||
      !this.phoneNumber ||
      !this.metadata
    ) {
      if (this.integrationId) {
        logger.warn(`Re-initializing Quo provider for ${this.integrationId}`)
        await this.initialize(this.integrationId)
      } else {
        throw new Error('OpenPhoneProvider not initialized with an integration ID.')
      }
    }
  }

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  /**
   * Sends an SMS via `POST /v1/messages`.
   *
   * The wire shape is `{ content, from, to: string[] }` — `from` takes the E.164 number (or the
   * `PN…` id; `phoneNumberId` is deprecated) and `to` is an ARRAY of 1–10 recipients. Group SMS
   * therefore works: recipients are passed through rather than truncated to the first one.
   *
   * **Returns `threadId` = the response's `conversationId`, and that is load-bearing.** It is
   * what `MessageReconcilerService` stamps onto `Thread.externalId` + `ThreadExternalKey`, which
   * is in turn the only thing that lets the customer's reply land on this thread instead of
   * opening a new one. Dropping it used to leave the outbound thread keyless until the
   * `message.delivered` echo arrived — a race the customer wins whenever they reply inside a few
   * seconds, which on a support line is the normal case.
   */
  async sendMessage(
    options: SendMessageOptions
  ): Promise<{ id?: string; success: boolean; threadId?: string }> {
    await this.ensureInitialized()

    const requested = (Array.isArray(options.to) ? options.to : [options.to])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim())
    if (requested.length === 0) {
      throw new Error(
        "At least one recipient phone number (E.164) is required in 'to' for Quo messages."
      )
    }
    if (!options.text) {
      throw new Error('Message body (text) is required for a Quo SMS.')
    }

    let recipients = requested
    if (recipients.length > MAX_RECIPIENTS_PER_MESSAGE) {
      logger.warn('Quo accepts at most 10 recipients per message — truncating', {
        requested: recipients.length,
        kept: MAX_RECIPIENTS_PER_MESSAGE,
        integrationId: this.integrationId,
      })
      recipients = recipients.slice(0, MAX_RECIPIENTS_PER_MESSAGE)
    }

    try {
      const sent = await sendQuoMessage(this.apiKey!, {
        content: options.text,
        from: this.phoneNumber!,
        to: recipients,
      })
      logger.info('Quo SMS sent successfully', {
        messageId: sent.id,
        conversationId: sent.conversationId,
        recipients: recipients.length,
        integrationId: this.integrationId,
      })
      return { id: sent.id, success: true, threadId: sent.conversationId }
    } catch (error: any) {
      logger.error('Error sending Quo SMS', {
        error: error?.message,
        recipients: recipients.length,
        integrationId: this.integrationId,
      })
      throw error
    }
  }

  // -------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------

  /**
   * Arms a `message.received` / `message.delivered` / `call.completed` /
   * `call.recording.completed` webhook scoped to this channel's number (message-type-overhaul
   * Phase 4). Deliberately excludes `call.ringing` (no-op — no row is ever created for it) and
   * the summary/transcript/contact events, which carry no `phoneNumberId` and cannot be resolved
   * by the route's channel-scoped lookup — see `QuoCreateMessageWebhookInput`.
   *
   * ```
   * POST /v1/webhooks/messages
   * { url, events, resourceIds: [PN…], label, status: 'enabled' }
   *   → { data: { id: 'WH…', key: '<base64 32 bytes>' } }
   * ```
   *
   * Two properties of the create call, both verified live, shape this:
   * - **Quo mints and returns the signing key** on create, so nobody has to paste it into the
   *   connect form. It is merged onto the Credential's secret bag as `webhookSigningSecret` —
   *   exactly the field the webhook route reveals via
   *   `resolveWebhookSecret({ kind: 'credentialField', field: 'webhookSigningSecret' })`.
   *   `mergeSecretFields` merges, so the stored `apiKey` is never clobbered.
   * - **The URL is not reachability-checked**, so there is no ordering dependency on our
   *   endpoint being live — this works in dev without a tunnel already running.
   *
   * **Webhooks are immutable — create and delete only.** `/v1/webhooks/{id}` routes `GET` and
   * `DELETE`; `PATCH`, `PUT` and `POST` all 404 with Express's `Cannot PATCH /v1/webhooks/…`, and
   * there is no `/enable` sub-route either (probed against the live API). So the
   * create-`disabled`-then-enable sequence this originally shipped with could never work: the
   * create succeeded, the enable 404'd, and the rollback tore the webhook straight back down —
   * a channel that reported connected and received nothing.
   *
   * The consequence is an unavoidable window: the webhook is live from the moment it is created,
   * but its signing key only exists in the create *response*, so it cannot be stored beforehand.
   * A message landing in the ~200ms before `mergeSecretFields` commits fails verification and is
   * dropped. There is no API shape that closes this — a dropped inbound SMS during provisioning
   * is the cheapest of the available failure modes.
   *
   * **Idempotency: delete-then-recreate.** Re-arming with a stored `webhookId` deletes the old
   * webhook first, because (a) the callback URL changes between dev tunnels and Quo documents no
   * PATCH for `url`, and (b) the alternative — reusing the stored id — would leave a webhook
   * pointing at a dead URL live on the workspace. Deleting first guarantees at most one live
   * webhook per number, which is what makes teardown on disconnect unambiguous.
   */
  async setupWebhook(callbackUrl: string): Promise<void> {
    await this.ensureInitialized()

    const existingWebhookId = this.metadata?.webhookId
    if (existingWebhookId) {
      logger.info('Replacing existing Quo webhook before re-arming', {
        webhookId: existingWebhookId,
        integrationId: this.integrationId,
      })
      await this.deleteWebhookTolerantly(existingWebhookId)
    }

    const created = await createMessageWebhook(this.apiKey!, {
      url: callbackUrl,
      events: [
        'message.received',
        'message.delivered',
        'call.completed',
        'call.recording.completed',
      ],
      // Per-number rather than `["*"]`: it matches the one-channel-one-webhook model the rest of
      // the code assumes and makes teardown on disconnect unambiguous.
      resourceIds: [this.phoneNumberId!],
      label: `Auxx.ai — ${this.phoneNumber}`,
      status: 'enabled',
    })

    try {
      if (!created.key) {
        throw new Error('Quo did not return a signing key for the created webhook')
      }
      const merged = await mergeSecretFields(this.credentialId!, this.organizationId, {
        webhookSigningSecret: created.key,
      })
      if (merged.isErr()) {
        throw new Error(`Failed to store the Quo webhook signing secret: ${merged.error.message}`)
      }

      // jsonb merge, not a whole-object replace — a concurrent write (settings, backfill
      // progress) must not be wiped by stale in-memory metadata.
      await db
        .update(schema.Integration)
        .set({
          metadata: sql`COALESCE(${schema.Integration.metadata}, '{}'::jsonb) || jsonb_build_object('webhookId', ${created.id}::text)`,
        })
        .where(eq(schema.Integration.id, this.integrationId!))
      if (this.metadata) this.metadata.webhookId = created.id

      logger.info('Quo webhook armed', {
        webhookId: created.id,
        phoneNumberId: this.phoneNumberId,
        integrationId: this.integrationId,
      })
    } catch (error: any) {
      // The webhook is live Quo-side but we could not persist what verifies it. Leaving it would
      // orphan a webhook nobody owns, delivering traffic we can only reject, so tear it back down
      // before surfacing the failure.
      logger.error('Failed to finish arming the Quo webhook — rolling back', {
        error: error?.message,
        webhookId: created.id,
        integrationId: this.integrationId,
      })
      await this.deleteWebhookTolerantly(created.id)
      throw error
    }
  }

  /** Removes the configured webhook. `DELETE /v1/webhooks/{id}` → 204. */
  async removeWebhook(): Promise<void> {
    await this.ensureInitialized()
    const webhookId = this.metadata?.webhookId
    if (!webhookId) {
      logger.warn('No stored Quo webhook ID found to remove.', {
        integrationId: this.integrationId,
      })
      return
    }

    const removed = await this.deleteWebhookTolerantly(webhookId)
    if (!removed) return // non-404 failure: keep the stored id so a retry can still find it

    await db
      .update(schema.Integration)
      .set({
        metadata: sql`COALESCE(${schema.Integration.metadata}, '{}'::jsonb) - 'webhookId'`,
      })
      .where(eq(schema.Integration.id, this.integrationId!))
      .catch((dbErr) => logger.error('Failed to clear webhookId after webhook delete', { dbErr }))
    if (this.metadata) this.metadata.webhookId = undefined
  }

  /**
   * `DELETE /v1/webhooks/{id}`, treating a 404 as success (already gone). Returns false only
   * when the webhook may still be live, so callers know not to forget its id.
   */
  private async deleteWebhookTolerantly(webhookId: string): Promise<boolean> {
    try {
      await deleteWebhook(this.apiKey!, webhookId)
      return true
    } catch (error: any) {
      if (error instanceof QuoApiError && error.status === 404) {
        logger.warn('Quo webhook already gone (404) — treating as deleted', { webhookId })
        return true
      }
      logger.error('Error deleting Quo webhook', {
        error: error?.message,
        webhookId,
        integrationId: this.integrationId,
      })
      return false
    }
  }

  // -------------------------------------------------------------------------
  // Backfill / sync
  // -------------------------------------------------------------------------

  /**
   * Backfills SMS history for this channel's number.
   *
   * Two modes, both built on the same ladder — Quo has no "list all messages for this number"
   * endpoint, so messages can only be reached through their conversation:
   *
   * ```
   * GET /v1/conversations?phoneNumbers[]=+1888…       (E.164, BRACKETED)
   * GET /v1/messages?phoneNumberId=PN…&participants=… (PN id, REPEATED BARE keys)
   * ```
   *
   * **Initial backfill** (nothing stamped in `metadata.backfill`) uses the bounded
   * expanding-window algorithm: widen `updatedAfter` through 1/3/6/12/24 months and then "all",
   * enumerating each step as a *ring* so no conversation is fetched twice, stopping at the first
   * window holding N candidates and capping enumeration at ~2N rows. Cost is then independent of
   * workspace size — identical whether the workspace holds 4k conversations or 4M.
   *
   * **Incremental** (backfill already completed) passes `since` straight through as
   * `updatedAfter` / `createdAfter`.
   *
   * Traps this respects, all verified live:
   * - Server order is `createdAt` DESC, **not** `lastActivityAt` — an old-but-active conversation
   *   sits thousands of rows deep, so the sort by `lastActivityAt` is done client-side and the
   *   window filter (not the page order) is what bounds the walk.
   * - `totalItems` is per-page; termination is on `nextPageToken` alone.
   * - `updatedAt` ≠ `lastActivityAt` — `updatedAfter` also moves on assignment/mute/snooze/read.
   *   It is a superset trigger: safe as a bound (no false negatives), but a hit does not mean
   *   there are new messages.
   * - Unknown query params are silently ignored, so a 200 never proves a filter worked.
   * - `excludeInactive` is unverified and deliberately unused.
   *
   * `lastSyncedAt` is stamped on **success only**. The previous implementation stamped it in the
   * catch block too, which made a channel that had never ingested anything look healthy.
   */
  async syncMessages(since?: Date): Promise<void> {
    await this.ensureInitialized()

    const limit = this.backfillConversationLimit()
    const state = this.metadata?.backfill
    const isInitialBackfill = !state?.completedAt

    logger.info('Starting Quo message sync', {
      phoneNumber: this.phoneNumber,
      mode: isInitialBackfill ? 'initial-backfill' : 'incremental',
      since: since?.toISOString(),
      limit,
      integrationId: this.integrationId,
    })

    if (isInitialBackfill) {
      await this.runInitialBackfill(limit, state)
    } else {
      await this.runIncrementalSync(since, limit)
    }

    await db
      .update(schema.Integration)
      .set({ lastSyncedAt: new Date() })
      .where(eq(schema.Integration.id, this.integrationId!))
  }

  private backfillConversationLimit(): number {
    const configured = this.metadata?.backfillConversationLimit
    return typeof configured === 'number' && configured > 0
      ? Math.floor(configured)
      : DEFAULT_BACKFILL_CONVERSATION_LIMIT
  }

  /** Capped, resumable first-connect backfill (plan §6.2). */
  private async runInitialBackfill(
    limit: number,
    resumeFrom: QuoBackfillState | undefined
  ): Promise<void> {
    // A resumed run pins the window it started with, so the candidate set does not drift.
    const candidates = resumeFrom
      ? {
          conversations: await this.enumerateConversations({
            updatedAfter: resumeFrom.windowStart ?? undefined,
            maxRows: limit * 2,
          }),
          windowStart: resumeFrom.windowStart,
        }
      : await this.collectBackfillCandidates(limit)

    const windowStart = candidates.windowStart
    const conversations = sortByLastActivityDesc(candidates.conversations).slice(0, limit)

    let startIndex = 0
    if (resumeFrom) {
      const found = resumeFrom.lastConversationId
        ? conversations.findIndex((c) => c.id === resumeFrom.lastConversationId)
        : -1
      startIndex = found >= 0 ? found + 1 : resumeFrom.completedConversations
      logger.info('Resuming Quo backfill', {
        startIndex,
        total: conversations.length,
        integrationId: this.integrationId,
      })
    }

    const state: QuoBackfillState = {
      startedAt: resumeFrom?.startedAt ?? new Date().toISOString(),
      windowStart,
      completedConversations: startIndex,
      lastConversationId: resumeFrom?.lastConversationId ?? null,
    }
    await this.writeBackfillState(state)

    for (let index = startIndex; index < conversations.length; index++) {
      const conversation = conversations[index]!
      await this.ingestConversation(conversation, { isInitialBackfill: true })
      state.completedConversations = index + 1
      state.lastConversationId = conversation.id
      if (state.completedConversations % BACKFILL_PROGRESS_WRITE_EVERY === 0) {
        await this.writeBackfillState(state)
      }
    }

    state.completedAt = new Date().toISOString()
    await this.writeBackfillState(state)
    // Lifting the received-time cutoff is the same signal Gmail/Outlook use — once this is
    // stamped, `message:received` fires normally again for this channel.
    await db
      .update(schema.Integration)
      .set({
        metadata: sql`COALESCE(${schema.Integration.metadata}, '{}'::jsonb) || jsonb_build_object('initialBackfillCompletedAt', ${state.completedAt}::text)`,
      })
      .where(eq(schema.Integration.id, this.integrationId!))
    this.storageService.setBackfillCutoff(null)

    logger.info('Quo initial backfill complete', {
      conversations: conversations.length,
      windowStart,
      integrationId: this.integrationId,
    })
  }

  /** Incremental pass: `since` becomes the `updatedAfter` / `createdAfter` bound. */
  private async runIncrementalSync(since: Date | undefined, limit: number): Promise<void> {
    // `updatedAfter` is a superset trigger, so a 24h floor never misses a conversation that
    // actually received a message; it just over-collects a few that only changed state.
    const sinceIso = (since ?? new Date(Date.now() - 24 * 60 * 60 * 1000)).toISOString()
    const conversations = sortByLastActivityDesc(
      await this.enumerateConversations({ updatedAfter: sinceIso, maxRows: limit * 2 })
    ).slice(0, limit)

    for (const conversation of conversations) {
      await this.ingestConversation(conversation, {
        isInitialBackfill: false,
        createdAfter: sinceIso,
      })
    }

    logger.info('Quo incremental sync complete', {
      conversations: conversations.length,
      since: sinceIso,
      integrationId: this.integrationId,
    })
  }

  /**
   * Step 1 of §6.2 — the bounded expanding window.
   *
   * Each step is enumerated as a ring (`updatedAfter = w[i]`, `updatedBefore = w[i-1]`), so
   * widening never re-fetches what a narrower window already returned. Enumeration stops at the
   * first window holding `limit` candidates, or at ~2 × `limit` rows, whichever comes first.
   */
  private async collectBackfillCandidates(
    limit: number
  ): Promise<{ conversations: QuoConversation[]; windowStart: string | null }> {
    const collected: QuoConversation[] = []
    const seen = new Set<string>()
    let previousStart: string | undefined
    let windowStart: string | null = null

    for (const months of BACKFILL_WINDOW_MONTHS) {
      const start = months === null ? undefined : monthsAgoIso(months)
      const ring = await this.enumerateConversations({
        updatedAfter: start,
        updatedBefore: previousStart,
        maxRows: Math.max(1, limit * 2 - collected.length),
      })
      for (const conversation of ring) {
        if (seen.has(conversation.id)) continue
        seen.add(conversation.id)
        collected.push(conversation)
      }
      previousStart = start
      windowStart = start ?? null
      logger.debug('Quo backfill window probe', {
        windowMonths: months,
        ringSize: ring.length,
        collected: collected.length,
        integrationId: this.integrationId,
      })
      if (collected.length >= limit || months === null) break
    }

    return { conversations: collected, windowStart }
  }

  /** Pages `/v1/conversations` to exhaustion (or `maxRows`), terminating on `nextPageToken`. */
  private async enumerateConversations(params: {
    updatedAfter?: string
    updatedBefore?: string
    maxRows: number
  }): Promise<QuoConversation[]> {
    const rows: QuoConversation[] = []
    let pageToken: string | undefined

    do {
      const page = await listConversations(this.apiKey!, {
        phoneNumber: this.phoneNumber!,
        maxResults: CONVERSATION_PAGE_SIZE,
        pageToken,
        updatedAfter: params.updatedAfter,
        updatedBefore: params.updatedBefore,
      })
      rows.push(...(page.data ?? []))
      // `totalItems` is per-page — `nextPageToken` is the only honest terminator.
      pageToken = page.nextPageToken ?? undefined
    } while (pageToken && rows.length < params.maxRows)

    return rows
  }

  /**
   * Fetches and stores every message in one conversation.
   *
   * `/v1/messages` matches the participant set EXACTLY (two `participants=` values return zero
   * rows), so this is necessarily one call per conversation with no batching.
   */
  private async ingestConversation(
    conversation: QuoConversation,
    options: { isInitialBackfill: boolean; createdAfter?: string }
  ): Promise<void> {
    const participants = (conversation.participants ?? []).filter(Boolean)
    if (participants.length === 0) {
      logger.debug('Skipping Quo conversation with no participants', {
        conversationId: conversation.id,
      })
      return
    }

    const messages: QuoRestMessage[] = []
    let pageToken: string | undefined
    let pages = 0

    try {
      do {
        const page = await listMessages(this.apiKey!, {
          phoneNumberId: this.phoneNumberId!,
          participants,
          maxResults: MESSAGE_PAGE_SIZE,
          pageToken,
          createdAfter: options.createdAfter,
        })
        messages.push(...(page.data ?? []))
        pageToken = page.nextPageToken ?? undefined
        pages++
      } while (pageToken && pages < MAX_MESSAGE_PAGES_PER_CONVERSATION)
    } catch (error: any) {
      // One bad conversation must not abort the whole run — the cursor still advances, and a
      // later incremental pass picks the thread up again.
      logger.error('Failed to fetch Quo messages for a conversation', {
        error: error?.message,
        conversationId: conversation.id,
        integrationId: this.integrationId,
      })
      return
    }

    const mapped = messages
      .map((message) => this.mapRestMessageToMessageData(message, conversation))
      .filter((message): message is MessageData => message !== null)
    if (mapped.length === 0) return

    await this.storageService.batchStoreMessages(mapped, undefined, options.isInitialBackfill)
  }

  private async writeBackfillState(state: QuoBackfillState): Promise<void> {
    await db
      .update(schema.Integration)
      .set({
        metadata: sql`COALESCE(${schema.Integration.metadata}, '{}'::jsonb) || jsonb_build_object('backfill', ${JSON.stringify(state)}::jsonb)`,
      })
      .where(eq(schema.Integration.id, this.integrationId!))
    if (this.metadata) this.metadata.backfill = state
  }

  /**
   * Maps a **REST** message (`QuoRestMessage`) into `MessageData`.
   *
   * Deliberately separate from the webhook mapper in the ingest route: REST says `text` and
   * `to: string[]`, the webhook says `body` and `to: string`. A shared type/mapper would read
   * `undefined` on one of the two paths and silently produce empty messages rather than crash.
   */
  private mapRestMessageToMessageData(
    message: QuoRestMessage,
    conversation: QuoConversation
  ): MessageData | null {
    if (!this.integrationId || !this.phoneNumber) {
      logger.error('Cannot convert Quo message, provider state invalid.')
      return null
    }
    try {
      const createdTime = new Date(message.createdAt)
      const isInbound = message.direction === 'incoming'
      const fromParticipant: ParticipantInputData = {
        identifier: message.from || (isInbound ? 'unknown_sender' : this.phoneNumber),
      }
      const recipients = (message.to ?? []).filter(Boolean)
      const toParticipants: ParticipantInputData[] = (
        recipients.length > 0 ? recipients : [isInbound ? this.phoneNumber : 'unknown_recipient']
      ).map((identifier) => ({ identifier }))

      // REST gives no media signal whatsoever, so an empty body is the only tell that a
      // media-only MMS existed. Placeholder rather than a blank bubble.
      const text = message.text?.trim() ? message.text : MEDIA_PLACEHOLDER

      return {
        externalId: message.id,
        externalThreadId: message.conversationId ?? conversation.id,
        integrationId: this.integrationId,
        organizationId: this.organizationId,
        createdTime,
        sentAt: createdTime,
        receivedAt: createdTime,
        subject: undefined, // SMS has no subject
        from: fromParticipant,
        to: toParticipants,
        cc: [],
        bcc: [],
        replyTo: [],
        // REST never returns media, and there is no inbound attachment ingestor for this
        // provider, so no MessageAttachment rows exist. `hasAttachments` is a workflow trigger
        // filter — claiming true fires attachment rules for bytes that were never fetched.
        hasAttachments: false,
        textPlain: text,
        snippet: text.substring(0, 100),
        isInbound,
        metadata: { quo_message: message, quo_conversation: conversation },
        keywords: [],
        labelIds: [],
        isFirstInThread: false,
        isAIGenerated: false,
        internetMessageId: undefined,
        inReplyTo: undefined,
        references: undefined,
        threadIndex: undefined,
        folderId: undefined,
      }
    } catch (error: any) {
      logger.error('Error converting Quo REST message to MessageData', {
        error: error?.message,
        messageId: message?.id,
        integrationId: this.integrationId,
      })
      return null
    }
  }

  getProviderName(): string {
    return 'openphone'
  }

  // --- Methods less applicable to Quo ---

  async archive(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    logger.warn(`'archive' not supported by the Quo provider for ${type} ${externalId}.`)
    return false
  }
  async markAsSpam(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    logger.warn(`'markAsSpam' not supported by the Quo provider for ${type} ${externalId}.`)
    return false
  }
  async trash(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    logger.warn(`'trash' not supported by the Quo provider for ${type} ${externalId}.`)
    return false
  }
  async restore(externalId: string, type: 'message' | 'thread'): Promise<boolean> {
    logger.warn(`'restore' not supported by the Quo provider for ${type} ${externalId}.`)
    return false
  }
  async createDraft(_options: SendMessageOptions): Promise<{ id: string; success: boolean }> {
    logger.warn("'createDraft' not applicable to the Quo provider — Quo has no drafts API.")
    return { id: '', success: false }
  }
  async updateDraft(_draftId: string, _options: Partial<SendMessageOptions>): Promise<boolean> {
    logger.warn("'updateDraft' not applicable to the Quo provider.")
    return false
  }
  async sendDraft(_draftId: string): Promise<{ id: string; success: boolean }> {
    logger.warn("'sendDraft' not applicable to the Quo provider.")
    return { id: '', success: false }
  }
  async getLabels(): Promise<any[]> {
    logger.warn("'getLabels' not applicable to the Quo provider.")
    return []
  }
  async createLabel(_options: any): Promise<any> {
    logger.warn("'createLabel' not applicable to the Quo provider.")
    throw new Error('Not implemented')
  }
  async updateLabel(_labelId: string, _options: any): Promise<boolean> {
    logger.warn("'updateLabel' not applicable to the Quo provider.")
    return false
  }
  async deleteLabel(_labelId: string): Promise<boolean> {
    logger.warn("'deleteLabel' not applicable to the Quo provider.")
    return false
  }
  async addLabel(
    _labelId: string,
    externalId: string,
    type: 'message' | 'thread'
  ): Promise<boolean> {
    logger.warn(`'addLabel' not applicable to the Quo provider for ${type} ${externalId}.`)
    return false
  }
  async removeLabel(
    _labelId: string,
    externalId: string,
    type: 'message' | 'thread'
  ): Promise<boolean> {
    logger.warn(`'removeLabel' not applicable to the Quo provider for ${type} ${externalId}.`)
    return false
  }

  /**
   * No-op returning null. `GET /v1/conversations/{id}` **does not exist** on Quo (`Cannot GET`) —
   * only the list endpoint, which would mean paging the whole address book to find one row. The
   * conversation is already carried on `MessageData.metadata.quo_conversation` at ingest time,
   * so nothing needs a live single-conversation read.
   */
  async getThread(externalThreadId: string): Promise<any> {
    logger.info('getThread is a no-op for Quo — there is no single-conversation endpoint.', {
      externalThreadId,
      integrationId: this.integrationId,
    })
    return null
  }

  async updateThreadStatus(externalThreadId: string, _status: MessageStatus): Promise<boolean> {
    logger.warn(`'updateThreadStatus' not supported for Quo conversation ${externalThreadId}.`)
    return false
  }
  async moveThread(externalThreadId: string, _destinationLabelId: string): Promise<boolean> {
    logger.warn(`'moveThread' not supported for Quo conversation ${externalThreadId}.`)
    return false
  }
  async simulateOperation(_operation: string, _targetId: string, _params?: any): Promise<any> {
    logger.warn('simulateOperation is not implemented for the Quo provider')
    return Promise.resolve({ success: false, message: 'Not implemented' })
  }
}

/**
 * Step 2 of §6.2 — REQUIRED. The server orders by `createdAt` DESC, so a conversation opened in
 * March that received a message yesterday sits thousands of rows deep. Sorting client-side by
 * `lastActivityAt` is the only way "the N most recently active conversations" means that.
 */
function sortByLastActivityDesc(conversations: QuoConversation[]): QuoConversation[] {
  return [...conversations].sort((a, b) => {
    const delta = activityMs(b) - activityMs(a)
    if (delta !== 0) return delta
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

function activityMs(conversation: QuoConversation): number {
  const value = Date.parse(conversation.lastActivityAt ?? conversation.updatedAt ?? '')
  return Number.isFinite(value) ? value : 0
}
