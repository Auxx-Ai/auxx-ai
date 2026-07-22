// packages/lib/src/signals/queries.ts
// Read-path for the communications view (client-notifications plan §4.8/Phase 4) — the job
// detail page section + drawer card, and the contact detail page section, all fan out through
// `EntitySignalLink` to find every signal touching one or more records. Functional Drizzle +
// Result, no model class (feedback: no new packages/services, no model classes).

import { type Database, database, schema } from '@auxx/database'
import { and, desc, eq, gte, inArray, lt, lte, or, type SQL } from 'drizzle-orm'
import { Result, type TypedResult } from '../result'

/** A signal row plus the subset of the queried `recordKeys` it's linked to. */
export interface SignalWithLinks {
  id: string
  organizationId: string
  kind: string
  subtype: string
  occurredAt: Date
  contactEntityInstanceId: string | null
  messageId: string | null
  threadId: string | null
  title: string
  metadata: Record<string, unknown> | null
  recordKeys: string[]
}

/** `EntitySignalLink.recordKey` bound per query — a job/contact page passes a handful. */
export const SIGNAL_RECORD_KEYS_MAX = 50

const DEFAULT_LIMIT = 100

/**
 * All signals linked to any of `recordKeys`, newest `occurredAt` first, deduplicated by signal
 * id (a signal can be linked to several of the queried keys at once — e.g. a visit reminder is
 * linked to both `work_order:<id>` and `visit:<id>`). The one query behind every communications
 * view (job page, job drawer card, contact page).
 *
 * `db` defaults to the shared `database` singleton — pass `ctx.db` from a tRPC procedure, or
 * omit it (`undefined`) from a script/lib caller.
 */
export async function listSignalsForRecordKeys(
  db: Database = database,
  organizationId: string,
  recordKeys: string[],
  limit: number = DEFAULT_LIMIT
): Promise<TypedResult<SignalWithLinks[], Error>> {
  const keys = recordKeys.slice(0, SIGNAL_RECORD_KEYS_MAX)
  if (keys.length === 0) return Result.ok([])

  try {
    const rows = await db
      .select({
        signal: schema.EntitySignal,
        recordKey: schema.EntitySignalLink.recordKey,
      })
      .from(schema.EntitySignalLink)
      .innerJoin(schema.EntitySignal, eq(schema.EntitySignalLink.signalId, schema.EntitySignal.id))
      .where(
        and(
          eq(schema.EntitySignalLink.organizationId, organizationId),
          inArray(schema.EntitySignalLink.recordKey, keys)
        )
      )
      .orderBy(desc(schema.EntitySignal.occurredAt))
      // Bounded above `limit` so a signal linked to several of the queried keys (multiple
      // matching link rows) still leaves room to de-dup down to `limit` distinct signals.
      .limit(Math.max(limit * 4, 200))

    const bySignalId = new Map<string, SignalWithLinks>()
    for (const { signal, recordKey } of rows) {
      const existing = bySignalId.get(signal.id)
      if (existing) {
        existing.recordKeys.push(recordKey)
        continue
      }
      bySignalId.set(signal.id, {
        id: signal.id,
        organizationId: signal.organizationId,
        kind: signal.kind,
        subtype: signal.subtype,
        occurredAt: signal.occurredAt,
        contactEntityInstanceId: signal.contactEntityInstanceId,
        messageId: signal.messageId,
        threadId: signal.threadId,
        title: signal.title,
        metadata: (signal.metadata as Record<string, unknown> | null) ?? null,
        recordKeys: [recordKey],
      })
    }

    const items = [...bySignalId.values()]
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit)

    return Result.ok(items)
  } catch (error) {
    return Result.error(
      error instanceof Error ? error : new Error('listSignalsForRecordKeys failed')
    )
  }
}

/** Default/max page size for `listSignals`. */
export const SIGNAL_LIST_DEFAULT_LIMIT = 50
export const SIGNAL_LIST_MAX_LIMIT = 200

export interface ListSignalsFilters {
  /** `EntitySignal.kind IN`. */
  kinds?: string[]
  /** `EntitySignal.subtype IN`. */
  subtypes?: string[]
  occurredAfter?: Date
  occurredBefore?: Date
  /** Default `false` (excludes bot-flagged signals); `true` removes the filter entirely. */
  includeBot?: boolean
  contactEntityInstanceId?: string
}

export interface ListSignalsParams {
  /** Defaults to the shared `database` singleton — pass `ctx.db` from a tRPC procedure. */
  db?: Database
  organizationId: string
  /** When present: only signals linked to these `EntitySignalLink.recordKey`s (join, deduped
   * by signal id) — capped at `SIGNAL_RECORD_KEYS_MAX`. Record scoping is always this join,
   * never a column filter, since a signal can touch several records at once. */
  recordKeys?: string[]
  filters?: ListSignalsFilters
  /** Opaque keyset cursor from a previous page's `nextCursor`. */
  cursor?: string
  /** Default `SIGNAL_LIST_DEFAULT_LIMIT`, capped at `SIGNAL_LIST_MAX_LIMIT`. */
  limit?: number
}

export interface ListSignalsResult {
  items: SignalWithLinks[]
  nextCursor: string | null
}

function toSignalWithLinks(
  signal: typeof schema.EntitySignal.$inferSelect,
  recordKeys: string[]
): SignalWithLinks {
  return {
    id: signal.id,
    organizationId: signal.organizationId,
    kind: signal.kind,
    subtype: signal.subtype,
    occurredAt: signal.occurredAt,
    contactEntityInstanceId: signal.contactEntityInstanceId,
    messageId: signal.messageId,
    threadId: signal.threadId,
    title: signal.title,
    metadata: (signal.metadata as Record<string, unknown> | null) ?? null,
    recordKeys,
  }
}

function encodeSignalCursor(occurredAt: Date, id: string): string {
  return Buffer.from(`${occurredAt.toISOString()}|${id}`, 'utf8').toString('base64')
}

function decodeSignalCursor(cursor: string): { occurredAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8')
    const separatorIndex = decoded.lastIndexOf('|')
    if (separatorIndex === -1) return null
    const occurredAt = new Date(decoded.slice(0, separatorIndex))
    const id = decoded.slice(separatorIndex + 1)
    if (Number.isNaN(occurredAt.getTime()) || !id) return null
    return { occurredAt, id }
  } catch {
    return null
  }
}

/**
 * Org-wide (optionally record-scoped) signal feed, newest `occurredAt` first with a stable
 * `id` tiebreak, keyset-paginated — the general-purpose read surface behind a future signals
 * inbox/filter view (plans/signals/01-signal-store.md "Read surfaces (v1)"), layered on top of
 * the per-record `listSignalsForRecordKeys`.
 *
 * NOTE: the plan originally wanted the generic `ConditionGroup` conditions system here; v1
 * ships typed `filters` instead and will integrate conditions when the record-rules signal
 * door lands (Phase 4).
 *
 * Reads via the `(organizationId, contactEntityInstanceId, occurredAt desc)` and
 * `(organizationId, kind, occurredAt desc)` indexes.
 */
export async function listSignals(
  params: ListSignalsParams
): Promise<TypedResult<ListSignalsResult, Error>> {
  const { db = database, organizationId, recordKeys, filters, cursor, limit: rawLimit } = params
  const limit = Math.min(Math.max(rawLimit ?? SIGNAL_LIST_DEFAULT_LIMIT, 1), SIGNAL_LIST_MAX_LIMIT)

  let cursorPos: { occurredAt: Date; id: string } | null = null
  if (cursor) {
    cursorPos = decodeSignalCursor(cursor)
    if (!cursorPos) return Result.error(new Error('Invalid signal cursor'))
  }

  const conditions: SQL[] = [eq(schema.EntitySignal.organizationId, organizationId)]
  if (filters?.kinds?.length) {
    conditions.push(inArray(schema.EntitySignal.kind, filters.kinds))
  }
  if (filters?.subtypes?.length) {
    conditions.push(inArray(schema.EntitySignal.subtype, filters.subtypes))
  }
  if (filters?.occurredAfter) {
    conditions.push(gte(schema.EntitySignal.occurredAt, filters.occurredAfter))
  }
  if (filters?.occurredBefore) {
    conditions.push(lte(schema.EntitySignal.occurredAt, filters.occurredBefore))
  }
  if (!filters?.includeBot) {
    conditions.push(eq(schema.EntitySignal.isBot, false))
  }
  if (filters?.contactEntityInstanceId) {
    conditions.push(
      eq(schema.EntitySignal.contactEntityInstanceId, filters.contactEntityInstanceId)
    )
  }
  if (cursorPos) {
    conditions.push(
      or(
        lt(schema.EntitySignal.occurredAt, cursorPos.occurredAt),
        and(
          eq(schema.EntitySignal.occurredAt, cursorPos.occurredAt),
          lt(schema.EntitySignal.id, cursorPos.id)
        )
      )!
    )
  }

  try {
    const keys = recordKeys?.slice(0, SIGNAL_RECORD_KEYS_MAX)

    if (keys) {
      if (keys.length === 0) return Result.ok({ items: [], nextCursor: null })

      // Pass 1: the correctly keyset-paginated, deduplicated set of signal ids — DISTINCT
      // because a signal linked to several of the queried keys otherwise produces one row
      // per link, which would break both `limit` and the cursor.
      const idRows = await db
        .selectDistinct({ id: schema.EntitySignal.id, occurredAt: schema.EntitySignal.occurredAt })
        .from(schema.EntitySignal)
        .innerJoin(
          schema.EntitySignalLink,
          eq(schema.EntitySignalLink.signalId, schema.EntitySignal.id)
        )
        .where(
          and(
            ...conditions,
            eq(schema.EntitySignalLink.organizationId, organizationId),
            inArray(schema.EntitySignalLink.recordKey, keys)
          )
        )
        .orderBy(desc(schema.EntitySignal.occurredAt), desc(schema.EntitySignal.id))
        .limit(limit + 1)

      const hasNextPage = idRows.length > limit
      const pageIds = idRows.slice(0, limit).map((row) => row.id)
      if (pageIds.length === 0) return Result.ok({ items: [], nextCursor: null })

      // Pass 2: hydrate those signals plus every matching link, to report which of the
      // queried `recordKeys` each one is linked to (mirrors `listSignalsForRecordKeys`).
      const linkRows = await db
        .select({ signal: schema.EntitySignal, recordKey: schema.EntitySignalLink.recordKey })
        .from(schema.EntitySignalLink)
        .innerJoin(
          schema.EntitySignal,
          eq(schema.EntitySignalLink.signalId, schema.EntitySignal.id)
        )
        .where(
          and(
            eq(schema.EntitySignalLink.organizationId, organizationId),
            inArray(schema.EntitySignalLink.signalId, pageIds),
            inArray(schema.EntitySignalLink.recordKey, keys)
          )
        )

      const bySignalId = new Map<string, SignalWithLinks>()
      for (const { signal, recordKey } of linkRows) {
        const existing = bySignalId.get(signal.id)
        if (existing) {
          existing.recordKeys.push(recordKey)
          continue
        }
        bySignalId.set(signal.id, toSignalWithLinks(signal, [recordKey]))
      }

      const items = pageIds
        .map((id) => bySignalId.get(id))
        .filter((item): item is SignalWithLinks => item !== undefined)

      const last = items.at(-1)
      const nextCursor = hasNextPage && last ? encodeSignalCursor(last.occurredAt, last.id) : null
      return Result.ok({ items, nextCursor })
    }

    const rows = await db
      .select()
      .from(schema.EntitySignal)
      .where(and(...conditions))
      .orderBy(desc(schema.EntitySignal.occurredAt), desc(schema.EntitySignal.id))
      .limit(limit + 1)

    const hasNextPage = rows.length > limit
    const items = rows.slice(0, limit).map((signal) => toSignalWithLinks(signal, []))
    const last = items.at(-1)
    const nextCursor = hasNextPage && last ? encodeSignalCursor(last.occurredAt, last.id) : null
    return Result.ok({ items, nextCursor })
  } catch (error) {
    return Result.error(error instanceof Error ? error : new Error('listSignals failed'))
  }
}

/**
 * One `EntitySignal` by id, org-scoped — the task origin line's "which signal created this
 * follow-up" lookup (plans/signals/06-follow-ups-build.md Step 7). Returns `null` when the
 * row was pruned by retention; callers degrade to rule-name-only copy.
 */
export async function getSignalById(
  db: Database = database,
  organizationId: string,
  signalId: string
): Promise<TypedResult<SignalWithLinks | null, Error>> {
  try {
    const [row] = await db
      .select()
      .from(schema.EntitySignal)
      .where(
        and(
          eq(schema.EntitySignal.organizationId, organizationId),
          eq(schema.EntitySignal.id, signalId)
        )
      )
      .limit(1)

    return Result.ok(row ? toSignalWithLinks(row, []) : null)
  } catch (error) {
    return Result.error(error instanceof Error ? error : new Error('getSignalById failed'))
  }
}

/**
 * Single indexed read on the unique `(organizationId, entityInstanceId)` — the header
 * chips/digest renderer/suppression-check surface reads this instead of scanning `EntitySignal`
 * (plans/signals/01-signal-store.md "Rollups"). Returns `null` when no signal has ever been
 * recorded for this entity instance.
 */
export async function getSignalRollup(
  organizationId: string,
  entityInstanceId: string
): Promise<TypedResult<schema.EntitySignalRollupEntity | null, Error>> {
  try {
    const [row] = await database
      .select()
      .from(schema.EntitySignalRollup)
      .where(
        and(
          eq(schema.EntitySignalRollup.organizationId, organizationId),
          eq(schema.EntitySignalRollup.entityInstanceId, entityInstanceId)
        )
      )
      .limit(1)

    return Result.ok(row ?? null)
  } catch (error) {
    return Result.error(error instanceof Error ? error : new Error('getSignalRollup failed'))
  }
}
