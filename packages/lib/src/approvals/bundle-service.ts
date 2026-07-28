// packages/lib/src/approvals/bundle-service.ts

import { type AiSuggestionEntity, type Database, schema, type Transaction } from '@auxx/database'
import { and, count, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { ConflictError, NotFoundError } from '../errors'
import { Result, type TypedResult } from '../result'
import type { HeadlessRunResult, StoredBundle } from './types'

type DbHandle = Database | Transaction

/**
 * Persist a headless run's actions as a FRESH bundle. Returns `Result.nil()`
 * (no row inserted) when `result.actions.length === 0` — the scanner still
 * bumps `EntityInstance.lastSuggestionScanAt` afterwards to suppress
 * re-compute.
 *
 * On unique-constraint violation (an active FRESH bundle already exists for
 * this entity), returns `Result.error(ConflictError)`. Caller decides whether
 * to retry, mark the existing bundle stale first, or no-op.
 */
export async function createBundleFromHeadlessRun(
  db: DbHandle,
  args: {
    result: HeadlessRunResult
    organizationId: string
    /** Null = unassigned; the Today feed shows unassigned bundles to every member. */
    ownerUserId: string | null
    entityInstanceId: string
    entityDefinitionId: string
    threadId?: string
    triggerSource: string
    triggerEventType?: string
  }
): Promise<TypedResult<AiSuggestionEntity | undefined, Error>> {
  const { result } = args
  if (result.actions.length === 0) {
    return Result.ok(undefined)
  }

  const bundle: StoredBundle = {
    actions: result.actions,
    summary: result.summary,
    noopReason: result.noopReason,
    modelId: result.modelId,
    headlessTraceId: result.headlessTraceId,
    computedForLatestMessageId: result.computedForLatestMessageId,
  }

  try {
    const [row] = await db
      .insert(schema.AiSuggestion)
      .values({
        organizationId: args.organizationId,
        entityInstanceId: args.entityInstanceId,
        entityDefinitionId: args.entityDefinitionId,
        threadId: args.threadId ?? null,
        ownerUserId: args.ownerUserId,
        bundle,
        actionCount: result.actions.length,
        computedForActivityAt: result.computedForActivityAt,
        computedForLatestMessageId: result.computedForLatestMessageId ?? null,
        triggerSource: args.triggerSource,
        triggerEventType: args.triggerEventType ?? null,
        status: 'FRESH',
      })
      .returning()
    if (!row) {
      return Result.error(new Error('Insert returned no row'))
    }
    return Result.ok(row)
  } catch (err) {
    // Postgres unique_violation is SQLSTATE 23505. Drizzle surfaces this on
    // the underlying pg error's `code` property.
    const code = (err as { code?: string })?.code
    if (code === '23505') {
      return Result.error(
        new ConflictError(`A FRESH bundle already exists for entity ${args.entityInstanceId}`)
      )
    }
    return Result.error(err instanceof Error ? err : new Error(String(err)))
  }
}

export async function getBundle(
  db: DbHandle,
  args: { id: string; organizationId: string }
): Promise<TypedResult<AiSuggestionEntity, Error>> {
  const row = await db.query.AiSuggestion.findFirst({
    where: and(
      eq(schema.AiSuggestion.id, args.id),
      eq(schema.AiSuggestion.organizationId, args.organizationId)
    ),
  })
  if (!row) return Result.error(new NotFoundError(`Bundle ${args.id} not found`))
  return Result.ok(row)
}

/**
 * Flip every FRESH bundle whose `computedForActivityAt < entity.lastActivityAt`
 * to STALE. Called by the scanner once per tick after candidate processing,
 * not per-entity (the bulk UPDATE is one round-trip vs N).
 *
 * Learned-extraction bundles are exempt: they propose memory from an
 * already-resolved conversation, so later activity on the anchor record does
 * not invalidate them.
 */
export async function markStaleBundles(
  db: DbHandle,
  args: { organizationId: string }
): Promise<TypedResult<{ updated: number }, Error>> {
  const result = await db
    .update(schema.AiSuggestion)
    .set({ status: 'STALE', updatedAt: new Date() })
    .where(
      and(
        eq(schema.AiSuggestion.organizationId, args.organizationId),
        eq(schema.AiSuggestion.status, 'FRESH'),
        ne(schema.AiSuggestion.triggerSource, 'learned-extraction'),
        sql`${schema.AiSuggestion.computedForActivityAt} < (
          SELECT ${schema.EntityInstance.lastActivityAt}
          FROM ${schema.EntityInstance}
          WHERE ${schema.EntityInstance.id} = ${schema.AiSuggestion.entityInstanceId}
        )`
      )
    )
    .returning({ id: schema.AiSuggestion.id })
  return Result.ok({ updated: result.length })
}

export interface ListBundlesArgs {
  organizationId: string
  /** Optional owner filter — when set, includes both the owner's bundles and unassigned. */
  ownerId?: string
  filters?: {
    status?: string[]
    entityDefinitionId?: string
  }
  /** Cursor is a base64-encoded `${createdAtIso}|${id}`; opaque to the caller. */
  cursor?: string
  /** Default 25, max 100. */
  limit?: number
}

export interface ListBundlesResult {
  items: AiSuggestionEntity[]
  nextCursor?: string
}

/**
 * Paginated list of bundles for the Today UI. Default ordering is FRESH-first
 * (status='FRESH' rows before terminal states), then `createdAt` descending.
 *
 * v1 ranking is intentionally simple — Phase 6 introduces the SLA/value/
 * confidence weighted score per the plan. For now we just sort by recency,
 * which mirrors the chat-tab default and is good enough until we have real
 * usage signals.
 */
export async function listBundles(
  db: DbHandle,
  args: ListBundlesArgs
): Promise<TypedResult<ListBundlesResult, Error>> {
  const limit = Math.min(args.limit ?? 25, 100)
  const statuses = args.filters?.status ?? ['FRESH']

  const conditions = [
    eq(schema.AiSuggestion.organizationId, args.organizationId),
    inArray(schema.AiSuggestion.status, statuses),
  ]
  if (args.filters?.entityDefinitionId) {
    conditions.push(eq(schema.AiSuggestion.entityDefinitionId, args.filters.entityDefinitionId))
  }
  if (args.ownerId) {
    conditions.push(
      sql`(${schema.AiSuggestion.ownerUserId} = ${args.ownerId} OR ${schema.AiSuggestion.ownerUserId} IS NULL)`
    )
  }
  const cursor = decodeCursor(args.cursor)
  if (cursor) {
    conditions.push(
      sql`(${schema.AiSuggestion.createdAt}, ${schema.AiSuggestion.id}) < (${cursor.createdAt}, ${cursor.id})`
    )
  }

  const rows = await db
    .select()
    .from(schema.AiSuggestion)
    .where(and(...conditions))
    .orderBy(desc(schema.AiSuggestion.createdAt), desc(schema.AiSuggestion.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : undefined

  return Result.ok({ items, nextCursor })
}

export interface CountBundlesArgs {
  organizationId: string
  /** Optional owner filter — when set, includes both the owner's bundles and unassigned. */
  ownerId?: string
  filters?: {
    status?: string[]
    entityDefinitionId?: string
  }
}

/**
 * Count bundles matching the same filter shape as {@link listBundles}, without
 * paging the rows in. Used by the notification panel's Approvals tab badge,
 * which needs the number before the user opens the tab.
 */
export async function countBundles(
  db: DbHandle,
  args: CountBundlesArgs
): Promise<TypedResult<{ count: number }, Error>> {
  const statuses = args.filters?.status ?? ['FRESH']

  const conditions = [
    eq(schema.AiSuggestion.organizationId, args.organizationId),
    inArray(schema.AiSuggestion.status, statuses),
  ]
  if (args.filters?.entityDefinitionId) {
    conditions.push(eq(schema.AiSuggestion.entityDefinitionId, args.filters.entityDefinitionId))
  }
  if (args.ownerId) {
    conditions.push(
      sql`(${schema.AiSuggestion.ownerUserId} = ${args.ownerId} OR ${schema.AiSuggestion.ownerUserId} IS NULL)`
    )
  }

  const [row] = await db
    .select({ value: count() })
    .from(schema.AiSuggestion)
    .where(and(...conditions))

  return Result.ok({ count: row?.value ?? 0 })
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url')
}

function decodeCursor(cursor?: string): { createdAt: Date; id: string } | undefined {
  if (!cursor) return undefined
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const [createdAtIso, id] = decoded.split('|')
    if (!createdAtIso || !id) return undefined
    return { createdAt: new Date(createdAtIso), id }
  } catch {
    return undefined
  }
}
