// packages/lib/src/signals/rollup.ts
// Rollup upsert for `EntitySignalRollup` — one row per (org, entityInstanceId), keyed on a
// signal's `contactEntityInstanceId` (plans/signals/01-signal-store.md "Rollups"). Called
// inline by `recordSignal()`/`recordSignals()` inside the same transaction as the insert, so
// rule conditions reading rollup fields see this signal's contribution before the
// `signal:recorded` bus event fires. The `*Count30d` columns only ever increment here — the
// nightly decay sweep (`rollup-sweep-job.ts`) recomputes them from `EntitySignal` so a
// backfilled/old `occurredAt` never inflates a live count.

import { type Database, schema, type Transaction } from '@auxx/database'
import { sql } from 'drizzle-orm'
import { isSignalKind, SIGNAL_KINDS } from './types'

type DbHandle = Database | Transaction

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export interface ApplyRollupForSignalInput {
  organizationId: string
  /** The rollup row's key — a signal's `contactEntityInstanceId` (never null; callers must
   * skip this function entirely for contact-less or bot-flagged signals). */
  entityInstanceId: string
  /** Raw signal kind string — narrowed via `isSignalKind` to look up the rollup family;
   * an unrecognized kind falls back to `'none'` (only `lastSignalAt` moves). */
  kind: string
  occurredAt: Date
  metadata?: Record<string, unknown> | null
}

/**
 * Upsert the `EntitySignalRollup` row for one signal's contribution — a single
 * `INSERT ... ON CONFLICT (organizationId, entityInstanceId) DO UPDATE`, switched on the
 * signal kind's `SIGNAL_KINDS[kind].rollup` family. Caller supplies the transaction handle;
 * this never opens its own transaction (it's always called from inside `recordSignal()`'s).
 */
export async function applyRollupForSignal(
  tx: DbHandle,
  input: ApplyRollupForSignalInput
): Promise<void> {
  const { organizationId, entityInstanceId, kind, occurredAt, metadata } = input
  const family = isSignalKind(kind) ? SIGNAL_KINDS[kind].rollup : 'none'
  const isRecent = occurredAt.getTime() >= Date.now() - THIRTY_DAYS_MS

  const insertValues: typeof schema.EntitySignalRollup.$inferInsert = {
    organizationId,
    entityInstanceId,
    lastSignalAt: occurredAt,
  }
  // Mixes plain values (insert path) and SQL fragments (GREATEST/increment on conflict) —
  // narrower than this would fight drizzle's own onConflictDoUpdate `set` typing for little
  // benefit; every branch is exercised by the verify script.
  const setValues: Record<string, unknown> = {
    lastSignalAt: sql`GREATEST(${schema.EntitySignalRollup.lastSignalAt}, excluded."lastSignalAt")`,
    updatedAt: sql`now()`,
  }

  switch (family) {
    case 'open':
      insertValues.lastOpenedAt = occurredAt
      insertValues.openCount30d = isRecent ? 1 : 0
      setValues.lastOpenedAt = sql`GREATEST(${schema.EntitySignalRollup.lastOpenedAt}, excluded."lastOpenedAt")`
      if (isRecent) {
        setValues.openCount30d = sql`${schema.EntitySignalRollup.openCount30d} + 1`
      }
      break
    case 'click':
      insertValues.lastClickedAt = occurredAt
      insertValues.clickCount30d = isRecent ? 1 : 0
      setValues.lastClickedAt = sql`GREATEST(${schema.EntitySignalRollup.lastClickedAt}, excluded."lastClickedAt")`
      if (isRecent) {
        setValues.clickCount30d = sql`${schema.EntitySignalRollup.clickCount30d} + 1`
      }
      break
    case 'visit':
      insertValues.lastVisitAt = occurredAt
      insertValues.visitCount30d = isRecent ? 1 : 0
      setValues.lastVisitAt = sql`GREATEST(${schema.EntitySignalRollup.lastVisitAt}, excluded."lastVisitAt")`
      if (isRecent) {
        setValues.visitCount30d = sql`${schema.EntitySignalRollup.visitCount30d} + 1`
      }
      break
    case 'reply':
      insertValues.lastRepliedAt = occurredAt
      setValues.lastRepliedAt = sql`GREATEST(${schema.EntitySignalRollup.lastRepliedAt}, excluded."lastRepliedAt")`
      break
    case 'unsubscribe':
      insertValues.unsubscribedAt = occurredAt
      setValues.unsubscribedAt = sql`GREATEST(${schema.EntitySignalRollup.unsubscribedAt}, excluded."unsubscribedAt")`
      break
    case 'resubscribe':
      insertValues.unsubscribedAt = null
      setValues.unsubscribedAt = sql`NULL`
      break
    case 'bounce': {
      const bounceType = metadata?.bounceType === 'soft' ? 'soft' : 'hard'
      insertValues.bouncedAt = occurredAt
      insertValues.bounceType = bounceType
      setValues.bouncedAt = sql`GREATEST(${schema.EntitySignalRollup.bouncedAt}, excluded."bouncedAt")`
      // Only adopt this signal's bounceType when it's also the newest bounce — an
      // out-of-order old soft bounce must not downgrade a newer hard bounce (suppression
      // keys on bounceType = 'hard').
      setValues.bounceType = sql`CASE
        WHEN ${schema.EntitySignalRollup.bouncedAt} IS NULL
          OR excluded."bouncedAt" >= ${schema.EntitySignalRollup.bouncedAt}
        THEN excluded."bounceType"
        ELSE ${schema.EntitySignalRollup.bounceType}
      END`
      break
    }
    default:
      // 'none' (and any unrecognized kind) — lastSignalAt (set above, unconditionally) is the
      // only column this family touches.
      break
  }

  await tx
    .insert(schema.EntitySignalRollup)
    .values(insertValues)
    .onConflictDoUpdate({
      target: [
        schema.EntitySignalRollup.organizationId,
        schema.EntitySignalRollup.entityInstanceId,
      ],
      set: setValues,
    })
}
