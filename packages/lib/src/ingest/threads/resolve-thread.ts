// packages/lib/src/ingest/threads/resolve-thread.ts

import { schema } from '@auxx/database'
import { IntegrationProviderType } from '@auxx/database/enums'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { IngestContext } from '../context'
import { parentMessageIdCandidates } from '../threading-headers'
import type { MessageData } from '../types'

/**
 * Providers whose conversation key is untrustworthy enough to justify falling
 * back to the RFC 5322 parentage chain.
 *
 * Deliberately excludes `google`: Gmail threads correctly via its own
 * `threadId`, and it *splits* long conversations on purpose while re-using
 * `References` across the halves — resolving by header there would merge
 * threads Gmail meant to keep apart. The alias lookup below is safe for every
 * provider and stays unconditional.
 */
const HEADER_CHAIN_PROVIDERS: ReadonlySet<string> = new Set<string>([
  IntegrationProviderType.outlook,
  IntegrationProviderType.imap,
])

/**
 * Bound on the `mergedIntoThreadId` walk. `Thread.mergeData` flattens transitive
 * merges, so a real chain is one hop; the extra hops are cycle-tolerant slack.
 */
const MAX_MERGE_HOPS = 3

export interface ResolvedThread {
  /** The thread the incoming message belongs to. Never a merged-away source. */
  threadId: string
  /** True when the provider conversation key was already aliased to this thread. */
  viaAlias: boolean
}

/**
 * Resolves the thread a message belongs to, before the Thread upsert.
 *
 * Provider conversation keys are not always stable — Microsoft Graph assigns a
 * fresh `conversationId` to a reply to a message we sent, which would otherwise
 * fork the conversation into a second thread. Falls back to the RFC 5322
 * parentage chain, which survives the fork because it is written by the sending
 * client, not by Exchange.
 *
 * The ladder implemented here is:
 *
 * 1. `ThreadExternalKey(integrationId, externalId)` — every conversation key we
 *    have ever seen, for every provider. A hit is authoritative.
 * 2. `In-Reply-To`, then `References` newest→oldest, matched against
 *    `Message.internetMessageId` within the same organization. Gated on the
 *    integration provider (see {@link HEADER_CHAIN_PROVIDERS}).
 * 3. Miss → `null`, and the caller keeps today's `conversationId` upsert.
 *
 * Never throws: a resolution failure degrades to `null`, i.e. exactly the
 * behaviour that shipped before this function existed. This runs on the hottest
 * write path in the system and must not be able to break ingest.
 *
 * @returns the resolved threadId and whether it came from the alias table (the
 * caller records an alias either way, but only the header path represents a
 * *new* merge).
 */
export async function resolveThreadId(
  ctx: IngestContext,
  messageData: MessageData
): Promise<ResolvedThread | null> {
  try {
    const aliasThreadId = await resolveByAlias(ctx, messageData)
    if (aliasThreadId) {
      const threadId = await followMergePointer(ctx, aliasThreadId)
      if (threadId) return { threadId, viaAlias: true }
    }

    const headerThreadId = await resolveByHeaderChain(ctx, messageData)
    if (headerThreadId) {
      const threadId = await followMergePointer(ctx, headerThreadId)
      if (threadId) return { threadId, viaAlias: false }
    }

    return null
  } catch (error) {
    ctx.logger.error('Thread resolution failed; falling back to conversation-key upsert', {
      externalId: messageData.externalId,
      externalThreadId: messageData.externalThreadId,
      integrationId: messageData.integrationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** Rung 1 — the provider conversation key we were handed, already aliased. */
async function resolveByAlias(
  ctx: IngestContext,
  messageData: MessageData
): Promise<string | null> {
  if (!messageData.externalThreadId || !messageData.integrationId) return null

  const [alias] = await ctx.db
    .select({ threadId: schema.ThreadExternalKey.threadId })
    .from(schema.ThreadExternalKey)
    .where(
      and(
        eq(schema.ThreadExternalKey.integrationId, messageData.integrationId),
        eq(schema.ThreadExternalKey.externalId, messageData.externalThreadId)
      )
    )
    .limit(1)

  return alias?.threadId ?? null
}

/** Rung 3 — RFC 5322 parentage, scoped to the integration, provider-gated. */
async function resolveByHeaderChain(
  ctx: IngestContext,
  messageData: MessageData
): Promise<string | null> {
  const candidates = parentMessageIdCandidates({
    inReplyTo: messageData.inReplyTo ?? undefined,
    references: messageData.references ?? undefined,
  })
  if (candidates.length === 0) return null

  // Provider lookup is deliberately *after* the candidate check so the common
  // no-headers message pays nothing for it. In practice the cache is already
  // warm — participant normalization resolved the same integration earlier in
  // `storeMessage`.
  const provider = await resolveProvider(ctx, messageData.integrationId)
  if (!provider || !HEADER_CHAIN_PROVIDERS.has(provider)) return null

  // `parentMessageIdCandidates` normalises to the angle-bracketed form, which is
  // how every write path stores `internetMessageId`. The bare variant is probed
  // alongside it purely as insurance against a path that stored it unbracketed —
  // still one index-backed lookup, still bounded (10 candidates → 20 values).
  const lookups: string[] = []
  for (const candidate of candidates) {
    lookups.push(candidate)
    const bare = candidate.slice(1, -1)
    if (bare && bare !== candidate) lookups.push(bare)
  }

  // Scoped to the SAME INTEGRATION, not just the same org. `Thread` is already
  // keyed per-integration (`Thread_integrationId_externalId_key`), so a thread has
  // never spanned two integrations — header resolution must not be the first thing
  // that makes it. Without this, two mailboxes connected as separate integrations
  // in one org and both on the same conversation would merge into one thread, and
  // the caller's `set` would then rewrite that thread's `inboxId` to the second
  // inbox — silently moving a thread across a permission boundary.
  const rows = await ctx.db
    .select({
      threadId: schema.Message.threadId,
      internetMessageId: schema.Message.internetMessageId,
    })
    .from(schema.Message)
    .where(
      and(
        eq(schema.Message.organizationId, messageData.organizationId),
        eq(schema.Message.integrationId, messageData.integrationId),
        inArray(schema.Message.internetMessageId, lookups)
      )
    )

  if (!rows.length) return null

  // Postgres returns matched rows in arbitrary order, so re-rank by CANDIDATE
  // order rather than trusting `rows[0]`: In-Reply-To must beat a References
  // entry when both are present in the same result set.
  const threadIdByMessageId = new Map<string, string>()
  for (const row of rows) {
    if (!row.internetMessageId || !row.threadId) continue
    if (!threadIdByMessageId.has(row.internetMessageId)) {
      threadIdByMessageId.set(row.internetMessageId, row.threadId)
    }
  }

  for (const candidate of candidates) {
    const hit =
      threadIdByMessageId.get(candidate) ?? threadIdByMessageId.get(candidate.slice(1, -1))
    if (hit) return hit
  }
  return null
}

/**
 * Resolves an integration's provider, populating the per-batch context cache.
 *
 * Mirrors the private helper in `participants/normalize.ts`, which normally
 * warms the same cache before this runs.
 */
async function resolveProvider(
  ctx: IngestContext,
  integrationId: string
): Promise<string | undefined> {
  if (!integrationId) return undefined
  const cached = ctx.providerByIntegrationId.get(integrationId)
  if (cached) return cached

  const [integration] = await ctx.db
    .select({ provider: schema.Integration.provider })
    .from(schema.Integration)
    .where(and(eq(schema.Integration.id, integrationId), isNull(schema.Integration.deletedAt)))
    .limit(1)

  const provider = integration?.provider
  if (provider) ctx.providerByIntegrationId.set(integrationId, provider)
  return provider ?? undefined
}

/**
 * Walks `Thread.mergedIntoThreadId` to the surviving thread.
 *
 * A merged-away source thread is hidden from every list, and the alias backfill
 * seeded rows for those sources too — landing on one would file the message
 * somewhere the user cannot see. Bounded and cycle-guarded.
 *
 * @returns the surviving thread id, or `null` when the thread no longer exists.
 */
async function followMergePointer(ctx: IngestContext, threadId: string): Promise<string | null> {
  let currentId = threadId
  const seen = new Set<string>([currentId])

  for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
    const [row] = await ctx.db
      .select({ id: schema.Thread.id, mergedIntoThreadId: schema.Thread.mergedIntoThreadId })
      .from(schema.Thread)
      .where(eq(schema.Thread.id, currentId))
      .limit(1)

    if (!row) return null
    const next = row.mergedIntoThreadId
    if (!next || seen.has(next)) return row.id
    seen.add(next)
    currentId = next
  }

  return currentId
}
