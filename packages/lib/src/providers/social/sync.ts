// packages/lib/src/providers/social/sync.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { MessageData } from '../../ingest/types'
import {
  type GraphConversation,
  isRateLimited,
  isReauthRequired,
  listConversationMessages,
  listConversations,
} from './api'
import { ingestSocialAttachments, type SocialAttachmentRef } from './attachments'
import {
  conversationMessageAttachmentRefs,
  conversationMessageExternalId,
  convertGraphConversationMessageToMessageData,
  pickConversationCounterpart,
  type TolerantConversationMessage,
} from './conversation-message'
import type { SocialPlatform } from './types'

const logger = createScopedLogger('social-sync')

/**
 * How many conversations one initial backfill ingests.
 *
 * **The bound is a CONVERSATION COUNT, not a time window, and that is the whole
 * design.** Graph returns `/{pageId}/conversations` newest-first by `updated_time`
 * (verified live on the Auxx-Lift page: page boundaries descend 2026-07 → 2025-08 →
 * 2025-02 → 2024-04 → 2023-09 → 2021-05), which makes a count cap a clean **prefix** —
 * take N and stop paginating. The implementation this replaces applied its `since`
 * filter *after* fetching, so a run read all 500+ conversations in order to discard
 * every one of them: cost scaled with the page's entire history rather than with what
 * we keep.
 *
 * Judged against a 100k-conversation page, not our test pages: 100 conversations costs
 * ~4 list requests (25 per page) plus one messages request each — ~104 Graph calls,
 * flat, whatever the page holds. That matters because **the cap is the only rate-limit
 * guard on this path**: unlike Quo there is no shared pacer in front of Graph.
 *
 * A constant, not a UI knob, until someone asks for one — but overridable per channel
 * via `Integration.metadata.backfillConversationLimit` for the one-off big-page case.
 */
export const SOCIAL_BACKFILL_CONVERSATION_LIMIT = 100

/**
 * Newest messages fetched per conversation. One request per conversation, no message
 * pagination: a five-year support thread is not worth 40 round trips during a first
 * connect, and anything older stays reachable in Messenger itself.
 */
export const SOCIAL_BACKFILL_MESSAGES_PER_CONVERSATION = 50

/** Graph's own default page size on the conversations edge. */
export const SOCIAL_CONVERSATION_PAGE_SIZE = 25

/** Persist resume progress every N conversations — 10 writes for a 100-conversation run. */
const BACKFILL_PROGRESS_WRITE_EVERY = 10

/**
 * Slack applied to the incremental message floor.
 *
 * `since` is OUR clock (`Integration.lastSyncedAt`) while `created_time` is Meta's, and
 * a message that lands a few seconds the wrong side of that difference would be dropped
 * *permanently* — the next run's `since` is later still. Five minutes of slack costs a
 * handful of re-presented messages, which `(integrationId, externalId)` dedupes anyway.
 */
const INCREMENTAL_CLOCK_SLACK_MS = 5 * 60 * 1000

/**
 * Resumable backfill progress, stored on `Integration.metadata.backfill`.
 *
 * Deliberately small — a position, not the conversation list. A resumed run
 * re-enumerates the same newest-first prefix (bounded: ~4 requests) and continues after
 * `lastConversationId`. A conversation whose `updated_time` bumps mid-run may shift
 * position and get re-fetched (harmless: ingest dedupes on `externalId`) or skipped —
 * and a bump means a live webhook already delivered that message.
 */
export interface SocialBackfillState {
  startedAt: string
  completedConversations: number
  lastConversationId?: string | null
  completedAt?: string | null
}

/** The `Integration.metadata` fields this module reads and writes. */
export interface SocialSyncMetadata {
  backfill?: SocialBackfillState
  backfillConversationLimit?: number
  backfillCutoffAt?: string
  initialBackfillCompletedAt?: string
}

/**
 * The received-time cutoff a provider should arm on `initialize()` — the **consume**
 * half of the WS7a contract, and it fails CLOSED.
 *
 * The expression this replaces was `backfillCutoffAt && !initialBackfillCompletedAt`,
 * which reads correctly and behaves dangerously: a channel with **no**
 * `backfillCutoffAt` evaluates falsy and gets no suppression at all. The live dev
 * channel is exactly that — connected before the stamp existed, and the stamp is
 * insert-only by design (a reconnect must never reopen a closed window), so it will
 * never acquire one. Under the old expression, backfilling it would publish
 * `message:received` for 500+ conversations back to 2021.
 *
 * The two failure modes are not symmetric. Suppressing when we did not need to costs
 * missed trigger fires on messages that are history by definition. *Not* suppressing
 * when we needed to fires thousands of workflow runs, agent replies and AI
 * classifications at real customers. So: **no cutoff and no completed backfill ⇒
 * suppress from now.** Only an explicit `initialBackfillCompletedAt` opens the gate.
 *
 * This is safe for live inbound because it is not on the live inbound path at all: the
 * webhook routes build their own `MessageStorageService` and never call
 * `setBackfillCutoff`. Only provider-driven sync runs see this value — and even for a
 * long-lived provider instance, a live message's `receivedAt` is after the instant this
 * returns, so it would not be suppressed anyway.
 */
export function resolveSocialBackfillCutoff(metadata: SocialSyncMetadata | null): Date | null {
  if (!metadata) return new Date()
  if (metadata.initialBackfillCompletedAt) return null
  return metadata.backfillCutoffAt ? new Date(metadata.backfillCutoffAt) : new Date()
}

/** Identity and credentials for one channel's sync run. */
export interface SocialSyncTarget {
  platform: SocialPlatform
  /**
   * Graph's `platform` query param on the conversations edge. Messenger and Instagram
   * Direct are two *platforms* on the same Page edge, not two endpoints.
   */
  graphPlatform: 'messenger' | 'instagram'
  /** The Facebook Page id the `/conversations` edge is addressed on — IG included. */
  pageId: string
  /**
   * Our identity inside the conversation: the Page id for Messenger, the **IG business
   * account id** for Instagram. This is what goes into the thread key and what the
   * webhook puts on our side, and for IG it is NOT the page id.
   */
  ourId: string
  ourName?: string
  pageAccessToken: string
  integrationId: string
  organizationId: string
  inboxId?: string
}

/**
 * The slice of `MessageStorageService` a sync run needs. Structural rather than the
 * class, so this module stays unit-testable without an ingest context.
 */
export interface SocialSyncStorage {
  batchStoreMessages(
    messages: MessageData[],
    batchId?: string,
    isInitialSync?: boolean
  ): Promise<number>
  setBackfillCutoff(cutoff: Date | null): void
}

export interface SocialSyncResult {
  mode: 'initial-backfill' | 'incremental'
  conversations: number
  messages: number
  /** True when the conversation cap, not the end of the list, ended enumeration. */
  reachedCap: boolean
}

/**
 * Backfills / catches up one Messenger or Instagram channel.
 *
 * **Two jobs, split — `syncMessages(since)` used to conflate them:**
 *
 * 1. *Initial backfill* — nothing stamped in `metadata.backfill.completedAt`. Walks the
 *    newest-first conversation prefix up to the count cap, resumably, and stamps
 *    `initialBackfillCompletedAt` at the end. **That stamp is load-bearing**: it is what
 *    closes the received-time suppression window, and a backfill that fails to stamp it
 *    leaves the channel silently unable to fire a workflow trigger ever again.
 * 2. *Incremental* — `since = lastSyncedAt`, and enumeration **stops at the first
 *    conversation older than `since`** rather than walking to the end. On a quiet page
 *    that is one request.
 *
 * `lastSyncedAt` is stamped on success only. The implementation this replaces stamped it
 * in its catch block too, which made a channel that had never ingested anything look
 * healthy.
 */
export async function syncSocialMessages(args: {
  target: SocialSyncTarget
  /** The provider's cached `Integration.metadata`. Updated in place as state is written. */
  metadata: SocialSyncMetadata
  storage: SocialSyncStorage
  since?: Date
}): Promise<SocialSyncResult> {
  const { target, metadata, storage, since } = args
  const isInitialBackfill = !metadata.backfill?.completedAt

  logger.info('Starting Meta conversation sync', {
    platform: target.platform,
    pageId: target.pageId,
    mode: isInitialBackfill ? 'initial-backfill' : 'incremental',
    since: since?.toISOString(),
    integrationId: target.integrationId,
  })

  const result = isInitialBackfill
    ? await runInitialBackfill(target, metadata, storage)
    : await runIncrementalSync(target, metadata, storage, since)

  await db
    .update(schema.Integration)
    .set({ lastSyncedAt: new Date() })
    .where(eq(schema.Integration.id, target.integrationId))

  logger.info('Meta conversation sync complete', {
    platform: target.platform,
    integrationId: target.integrationId,
    ...result,
  })
  return result
}

function conversationLimit(metadata: SocialSyncMetadata): number {
  const configured = metadata.backfillConversationLimit
  return typeof configured === 'number' && configured > 0
    ? Math.floor(configured)
    : SOCIAL_BACKFILL_CONVERSATION_LIMIT
}

async function runInitialBackfill(
  target: SocialSyncTarget,
  metadata: SocialSyncMetadata,
  storage: SocialSyncStorage
): Promise<SocialSyncResult> {
  const limit = conversationLimit(metadata)

  // Fail CLOSED before a single historical message is stored — see
  // `ensureBackfillCutoff`.
  await ensureBackfillCutoff(target.integrationId, metadata, storage)

  const resumeFrom = metadata.backfill
  const enumerated = await collectConversations(target, limit)
  const conversations = enumerated.conversations

  let startIndex = 0
  if (resumeFrom) {
    const found = resumeFrom.lastConversationId
      ? conversations.findIndex((conversation) => conversation.id === resumeFrom.lastConversationId)
      : -1
    // The cursor conversation can genuinely vanish from the prefix (deleted, or bumped
    // out by newer traffic). Falling back to the raw count re-does at most a few
    // conversations, which ingest dedupes, instead of skipping the rest of the run.
    startIndex =
      found >= 0 ? found + 1 : Math.min(resumeFrom.completedConversations, conversations.length)
    logger.info('Resuming Meta backfill', {
      startIndex,
      total: conversations.length,
      cursorFound: found >= 0,
      integrationId: target.integrationId,
    })
  }

  const state: SocialBackfillState = {
    startedAt: resumeFrom?.startedAt ?? new Date().toISOString(),
    completedConversations: startIndex,
    lastConversationId: resumeFrom?.lastConversationId ?? null,
  }
  await writeBackfillState(target.integrationId, metadata, state)

  let messages = 0
  for (let index = startIndex; index < conversations.length; index++) {
    const conversation = conversations[index]!
    messages += await ingestConversation(target, conversation, storage, {
      isInitialBackfill: true,
    })
    state.completedConversations = index + 1
    state.lastConversationId = conversation.id ?? null
    if (state.completedConversations % BACKFILL_PROGRESS_WRITE_EVERY === 0) {
      await writeBackfillState(target.integrationId, metadata, state)
    }
  }

  state.completedAt = new Date().toISOString()
  await writeBackfillState(target.integrationId, metadata, state)

  // Closing the suppression window is the last act of the backfill, and it is the half
  // of the WS7a contract that had no writer until now. Without it `setBackfillCutoff`
  // stays armed on every later `initialize()` and live inbound never fires a trigger
  // again — a channel that looks connected and behaves like a dead one.
  await db
    .update(schema.Integration)
    .set({
      metadata: sql`COALESCE(${schema.Integration.metadata}, '{}'::jsonb) || jsonb_build_object('initialBackfillCompletedAt', ${state.completedAt}::text)`,
    })
    .where(eq(schema.Integration.id, target.integrationId))
  metadata.initialBackfillCompletedAt = state.completedAt
  storage.setBackfillCutoff(null)

  return {
    mode: 'initial-backfill',
    conversations: conversations.length - startIndex,
    messages,
    reachedCap: enumerated.reachedCap,
  }
}

async function runIncrementalSync(
  target: SocialSyncTarget,
  metadata: SocialSyncMetadata,
  storage: SocialSyncStorage,
  since: Date | undefined
): Promise<SocialSyncResult> {
  // The scheduled path calls `syncMessages()` with no argument, so the floor has to come
  // from the row. `lastSyncedAt` rather than a fixed 24h window, because a fixed window
  // is a silent data-loss bug the moment the worker is down longer than it: a
  // conversation that changed two days ago would be skipped, and the NEXT run's floor is
  // later still, so it is skipped forever. 24h is only the last-resort floor for a
  // channel that has never recorded a sync.
  const floor =
    since ??
    (await lastSyncedAt(target.integrationId)) ??
    new Date(Date.now() - 24 * 60 * 60 * 1000)
  const enumerated = await collectConversations(target, conversationLimit(metadata), floor)

  const messageFloor = new Date(floor.getTime() - INCREMENTAL_CLOCK_SLACK_MS)
  let messages = 0
  for (const conversation of enumerated.conversations) {
    messages += await ingestConversation(target, conversation, storage, {
      isInitialBackfill: false,
      messageFloor,
    })
  }

  return {
    mode: 'incremental',
    conversations: enumerated.conversations.length,
    messages,
    reachedCap: enumerated.reachedCap,
  }
}

/**
 * Walks `/{pageId}/conversations` newest-first and returns the prefix to ingest.
 *
 * `stopBefore` is the incremental bound. Because the list descends by `updated_time`,
 * the first conversation older than it means every later one is older still — so
 * enumeration stops **paginating** there instead of reading to the end of five years of
 * history. The remaining entries of the page already in hand are still examined rather
 * than dropped wholesale: that costs no extra request and tolerates any local disorder
 * in Graph's ordering, which we have observed but not proven absent.
 */
async function collectConversations(
  target: SocialSyncTarget,
  limit: number,
  stopBefore?: Date
): Promise<{ conversations: GraphConversation[]; reachedCap: boolean }> {
  const conversations: GraphConversation[] = []
  const seen = new Set<string>()
  let nextUrl: string | undefined
  let reachedCap = false
  let sawOlderThanCutoff = false

  do {
    const page = await listConversations({
      pageId: target.pageId,
      pageAccessToken: target.pageAccessToken,
      platform: target.graphPlatform,
      nextUrl,
      limit: SOCIAL_CONVERSATION_PAGE_SIZE,
    })
    const rows = page.data ?? []
    if (rows.length === 0) break

    for (const conversation of rows) {
      if (!conversation.id || seen.has(conversation.id)) continue
      if (stopBefore && conversation.updated_time) {
        const updated = new Date(conversation.updated_time)
        if (!Number.isNaN(updated.getTime()) && updated < stopBefore) {
          sawOlderThanCutoff = true
          continue
        }
      }
      seen.add(conversation.id)
      conversations.push(conversation)
      if (conversations.length >= limit) {
        reachedCap = true
        break
      }
    }

    if (reachedCap || sawOlderThanCutoff) break
    nextUrl = page.paging?.next ?? undefined
  } while (nextUrl)

  logger.debug('Enumerated Meta conversations', {
    platform: target.platform,
    collected: conversations.length,
    reachedCap,
    stoppedOnCutoff: sawOlderThanCutoff,
    integrationId: target.integrationId,
  })
  return { conversations, reachedCap }
}

/**
 * Fetches the newest page of one conversation's messages and stores them.
 *
 * A failure on one conversation is logged and skipped so the cursor still advances —
 * **except** when the token is dead or Meta is throttling us, which are conditions the
 * remaining 99 conversations will hit identically. Those abort the run so the retry
 * happens later rather than burning the whole cap against a wall.
 */
async function ingestConversation(
  target: SocialSyncTarget,
  conversation: GraphConversation,
  storage: SocialSyncStorage,
  options: { isInitialBackfill: boolean; messageFloor?: Date }
): Promise<number> {
  const conversationId = conversation.id
  if (!conversationId) return 0

  // Both of our ids: on Instagram the thread key uses the IG business account id while
  // the edge is addressed on the Page, and which of the two Graph lists as a participant
  // is unverified. Excluding both is right either way.
  const counterpart = pickConversationCounterpart(conversation, [target.ourId, target.pageId])
  if (!counterpart) {
    logger.warn('Meta conversation has no counterpart participant; skipping', {
      platform: target.platform,
      conversationId,
      integrationId: target.integrationId,
    })
    return 0
  }

  let nodes: TolerantConversationMessage[]
  try {
    const page = await listConversationMessages({
      conversationId,
      pageAccessToken: target.pageAccessToken,
      limit: SOCIAL_BACKFILL_MESSAGES_PER_CONVERSATION,
    })
    nodes = (page.data ?? []) as TolerantConversationMessage[]
  } catch (error) {
    if (isReauthRequired(error) || isRateLimited(error)) throw error
    logger.error('Failed to fetch messages for a Meta conversation', {
      platform: target.platform,
      conversationId,
      integrationId: target.integrationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }

  const messages = nodes
    .filter((node) => {
      if (!options.messageFloor || !node.created_time) return true
      const created = new Date(node.created_time)
      return Number.isNaN(created.getTime()) || created >= options.messageFloor
    })
    .map((node) =>
      convertGraphConversationMessageToMessageData({
        message: node,
        conversationId,
        integrationId: target.integrationId,
        organizationId: target.organizationId,
        inboxId: target.inboxId,
        ourId: target.ourId,
        // Instagram only: the edge is addressed on the linked Page while our
        // identity is the IGBID, and Graph may name either as the business on a
        // page-sent node. Accepting both as "us" is the same defence
        // `pickConversationCounterpart` already applies — without it, an IG
        // backfill silently drops every message the page ever sent.
        ourAliasIds: target.pageId === target.ourId ? undefined : [target.pageId],
        counterpartId: counterpart.id,
        counterpartName: counterpart.name,
        ourName: target.ourName,
        platform: target.platform,
      })
    )
    .filter((message): message is MessageData => message !== null)

  if (messages.length === 0) return 0
  // `isInitialSync` on the backfill leg suppresses `message:received` for the whole
  // batch independently of the received-time cutoff — two guards, because publishing
  // five years of history into workflow triggers and agent runs is not recoverable.
  const stored = await storage.batchStoreMessages(messages, undefined, options.isInitialBackfill)

  await ingestConversationAttachments(target, nodes, messages)

  return stored
}

/**
 * Downloads the attachments of a conversation's just-stored messages.
 *
 * Runs after the batch rather than inside the converter because `Attachment` rows
 * hang off a `Message.id`, and `batchStoreMessages` answers with a count — so the
 * ids are recovered here with one indexed lookup on
 * `(integrationId, externalId)`, the same key ingest deduped on.
 *
 * No realtime patch: a backfill publishes nothing per message by design
 * (`isInitialSync`), and an incremental run's messages arrive by webhook first —
 * whose own `after()` ingest already fetched these bytes and made this a no-op.
 *
 * Never throws. A backfill that has stored a conversation must advance its cursor
 * even if every CDN link in it had expired.
 */
async function ingestConversationAttachments(
  target: SocialSyncTarget,
  nodes: TolerantConversationMessage[],
  stored: MessageData[]
): Promise<void> {
  const refsByExternalId = new Map<string, SocialAttachmentRef[]>()
  for (const node of nodes) {
    const refs = conversationMessageAttachmentRefs(node)
    if (refs.length === 0) continue
    const externalId = conversationMessageExternalId(node)
    if (externalId) refsByExternalId.set(externalId, refs)
  }
  if (refsByExternalId.size === 0) return

  const externalIds = stored
    .map((message) => message.externalId)
    .filter((externalId) => refsByExternalId.has(externalId))
  if (externalIds.length === 0) return

  try {
    const rows = await db
      .select({ id: schema.Message.id, externalId: schema.Message.externalId })
      .from(schema.Message)
      .where(
        and(
          eq(schema.Message.integrationId, target.integrationId),
          inArray(schema.Message.externalId, externalIds)
        )
      )

    for (const row of rows) {
      const refs = row.externalId ? refsByExternalId.get(row.externalId) : undefined
      if (!refs || !row.externalId) continue
      await ingestSocialAttachments({
        refs,
        organizationId: target.organizationId,
        messageId: row.id,
        contentScopeId: row.externalId,
        platform: target.platform,
      })
    }
  } catch (error) {
    logger.error('Attachment ingest failed for a Meta conversation (ignored)', {
      platform: target.platform,
      integrationId: target.integrationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Arms the received-time cutoff for a channel that has none — the **fail-closed**
 * decision, taken deliberately.
 *
 * The consume side in both providers reads
 * `backfillCutoffAt && !initialBackfillCompletedAt`, so a channel with **no**
 * `backfillCutoffAt` evaluates falsy and gets *no* suppression at all. That is not a
 * hypothetical: the live dev channel was connected before the stamp existed, and the
 * stamp is insert-only by design (a reconnect must never reopen a closed window), so it
 * will never acquire one. Running a backfill against it as-is publishes
 * `message:received` for 500+ conversations back to 2021 — mass-firing workflow
 * triggers, agent runs and AI classification against real customer mail.
 *
 * Fail-open is the wrong default because the two failure modes are not symmetric. A
 * cutoff wrongly armed costs missed trigger fires on messages that are *history* by
 * definition; a cutoff wrongly absent sends thousands of automated replies to real
 * people. So: no cutoff **and** no completed backfill ⇒ suppress from now.
 *
 * Stamped rather than merely computed, so the value is durable, visible in the row, and
 * identical across a resumed run. This cannot reopen a closed window — a closed window
 * implies `initialBackfillCompletedAt`, and this only runs on the initial-backfill leg.
 */
async function ensureBackfillCutoff(
  integrationId: string,
  metadata: SocialSyncMetadata,
  storage: SocialSyncStorage
): Promise<void> {
  if (metadata.initialBackfillCompletedAt) return
  if (metadata.backfillCutoffAt) {
    storage.setBackfillCutoff(new Date(metadata.backfillCutoffAt))
    return
  }

  const cutoff = new Date()
  await db
    .update(schema.Integration)
    .set({
      metadata: sql`COALESCE(${schema.Integration.metadata}, '{}'::jsonb) || jsonb_build_object('backfillCutoffAt', ${cutoff.toISOString()}::text)`,
    })
    .where(eq(schema.Integration.id, integrationId))
  metadata.backfillCutoffAt = cutoff.toISOString()
  storage.setBackfillCutoff(cutoff)

  logger.warn('Channel had no backfillCutoffAt — stamping one before backfilling', {
    integrationId,
    cutoffAt: cutoff.toISOString(),
  })
}

/** The channel's last successful sync instant, or `null` if it has never synced. */
async function lastSyncedAt(integrationId: string): Promise<Date | null> {
  const [row] = await db
    .select({ lastSyncedAt: schema.Integration.lastSyncedAt })
    .from(schema.Integration)
    .where(eq(schema.Integration.id, integrationId))
    .limit(1)
  return row?.lastSyncedAt ?? null
}

/** jsonb `||` merge, never a whole-object `set` — a reconnect writes this blob too. */
async function writeBackfillState(
  integrationId: string,
  metadata: SocialSyncMetadata,
  state: SocialBackfillState
): Promise<void> {
  await db
    .update(schema.Integration)
    .set({
      metadata: sql`COALESCE(${schema.Integration.metadata}, '{}'::jsonb) || jsonb_build_object('backfill', ${JSON.stringify(state)}::jsonb)`,
    })
    .where(eq(schema.Integration.id, integrationId))
  metadata.backfill = { ...state }
}
