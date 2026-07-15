// packages/lib/src/signals/queries.ts
// Read-path for the communications view (client-notifications plan §4.8/Phase 4) — the job
// detail page section + drawer card, and the contact detail page section, all fan out through
// `EntitySignalLink` to find every signal touching one or more records. Functional Drizzle +
// Result, no model class (feedback: no new packages/services, no model classes).

import { type Database, database, schema } from '@auxx/database'
import { and, desc, eq, inArray } from 'drizzle-orm'
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
