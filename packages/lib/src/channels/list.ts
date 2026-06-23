// packages/lib/src/channels/list.ts

import { type Database, schema } from '@auxx/database'
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getOrgCache } from '../cache'
import { getImportCacheSize } from '../email/polling-import-cache'
import { NotFoundError } from '../errors'
import { Result, type TypedResult } from '../result'
import { getIdentifier } from './internal/identifier'
import type { ChannelCtx } from './types'

// Org cache JSON-roundtrips, turning Date columns into ISO strings.
function toDate<T extends Date | null>(v: T | string): T {
  if (v === null || v instanceof Date) return v as T
  return new Date(v) as T
}

/**
 * Get all channels for the org (admin Channels page payload).
 *
 * Reads cached metadata (provider, name, settings, auth state, chat widget,
 * inbox link…) and merges live sync-state columns (`syncStatus`, `syncStage`,
 * `syncStageStartedAt`, throttle counters) plus Redis pending-import counts.
 * Sync state isn't cached because it flips too often and is only read on the
 * admin Channels page.
 */
export async function list(ctx: ChannelCtx) {
  const cached = await getOrgCache().get(ctx.organizationId, 'channels')

  const ids = cached.map((c) => c.id)
  const liveState = ids.length
    ? await ctx.db
        .select({
          id: schema.Integration.id,
          syncStatus: schema.Integration.syncStatus,
          syncStage: schema.Integration.syncStage,
          syncStageStartedAt: schema.Integration.syncStageStartedAt,
          throttleFailureCount: schema.Integration.throttleFailureCount,
          throttleRetryAfter: schema.Integration.throttleRetryAfter,
        })
        .from(schema.Integration)
        .where(and(inArray(schema.Integration.id, ids), isNull(schema.Integration.deletedAt)))
    : []
  const liveMap = new Map(liveState.map((r) => [r.id, r]))

  const syncingIds = liveState.filter((r) => r.syncStatus === 'SYNCING').map((r) => r.id)
  const importCounts = await Promise.all(
    syncingIds.map(async (id) => ({ id, count: await getImportCacheSize(id) }))
  )
  const countMap = new Map(importCounts.map((c) => [c.id, c.count]))

  const channels = cached.map((c) => {
    const live = liveMap.get(c.id)
    return {
      id: c.id,
      provider: c.provider,
      name: c.name,
      enabled: c.enabled,
      updatedAt: toDate(c.updatedAt),
      lastSyncedAt: toDate(c.lastSyncedAt),
      email: c.email || (c.metadata as any)?.email || undefined,
      identifier: getIdentifier({ ...c, chatWidget: c.chatWidget }),
      inboxId: c.inboxId,
      widgetSettings: c.provider === 'chat' ? c.chatWidget : undefined,
      lastSuccessfulSync: toDate(c.lastSuccessfulSync),
      metadata: c.metadata,
      requiresReauth: c.requiresReauth,
      lastAuthError: c.lastAuthError,
      lastAuthErrorAt: toDate(c.lastAuthErrorAt),
      settings: c.settings,
      isExample: c.isExample,
      syncStatus: live?.syncStatus ?? null,
      syncStage: live?.syncStage ?? null,
      syncStageStartedAt: live?.syncStageStartedAt ?? null,
      throttleFailureCount: live?.throttleFailureCount ?? 0,
      throttleRetryAfter: live?.throttleRetryAfter ?? null,
      pendingImportCount: countMap.get(c.id) ?? 0,
    }
  })

  return { channels }
}

/**
 * Count channels that consume the org's `channels` plan limit.
 *
 * Excludes auto-provisioned channels the user didn't create and shouldn't be
 * billed for: the system-managed `*@mail.auxx.ai` forwarding address
 * (`metadata.systemManaged === true`) and seeded example integrations
 * (`isExample`). Soft-deleted rows are excluded too. Used by both the
 * channel-create guard and overage detection so the two stay in sync.
 */
export async function countBillableChannels(db: Database, organizationId: string): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.organizationId, organizationId),
        isNull(schema.Integration.deletedAt),
        eq(schema.Integration.isExample, false),
        sql`coalesce(${schema.Integration.metadata}->>'systemManaged', 'false') <> 'true'`
      )
    )
  return result?.value ?? 0
}

/**
 * Single-id provider-type lookup. Kept as a standalone endpoint (no point
 * routing through `list()` for one id).
 */
export async function getProviderType(
  ctx: ChannelCtx,
  channelId: string
): Promise<TypedResult<{ provider: string }, NotFoundError>> {
  const [row] = await ctx.db
    .select({ provider: schema.Integration.provider })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.id, channelId),
        eq(schema.Integration.organizationId, ctx.organizationId),
        isNull(schema.Integration.deletedAt)
      )
    )
    .limit(1)

  if (!row) return Result.error(new NotFoundError('Channel not found'))
  return Result.ok({ provider: row.provider })
}
