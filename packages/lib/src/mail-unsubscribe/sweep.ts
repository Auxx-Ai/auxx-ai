// packages/lib/src/mail-unsubscribe/sweep.ts
// The "did they actually stop?" measurement (§6.4), split from the job wrapper
// so the decision is unit-testable without BullMQ or a database.
//
// This is what turns `lastSeenAfterAt` / `messagesSeenAfter` into a real answer
// to a real annoyance: *"Stripe ignored your unsubscribe — 6 more since.
// Filter it?"*

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, count, eq, gt, inArray, max } from 'drizzle-orm'
import { UNSUBSCRIBE_IGNORED_AFTER_DAYS, type UnsubscribeStatus } from './client'
import { buildSubjectKeyPredicate } from './subject-key'
import { applyUnsubscribeSweepObservation } from './unsubscribe-mutations'

const logger = createScopedLogger('mail-unsubscribe:sweep')

/** What one pass observed for one unsubscribed group. */
export interface SweepObservation {
  messagesSeenAfter: number
  lastSeenAfterAt: Date | null
}

/** The persisted state a sweep pass compares against. */
export interface SweepableUnsubscribe {
  id: string
  organizationId: string
  inboxId: string
  subjectKey: string
  requestedAt: Date
  status: UnsubscribeStatus
  messagesSeenAfter: number
  lastSeenAfterAt: Date | null
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Decide what to write for one row, or `null` for "nothing changed".
 *
 * The `ignored` flip needs BOTH conditions and neither alone:
 *
 * - **≥ {@link UNSUBSCRIBE_IGNORED_AFTER_DAYS} days since `requestedAt`.**
 *   Senders take days to honor an unsubscribe; flipping earlier would call
 *   normal latency a broken promise.
 * - **At least one message actually arrived since.** Silence past the deadline
 *   is the sender HONORING us, and marking that `ignored` would be exactly
 *   backwards.
 *
 * Only `requested` flips. `confirmed` means the endpoint told us it worked and
 * `failed` means we never got through — neither is a claim the sender ignored
 * us — and `ignored` is already terminal.
 *
 * Returns `null` when nothing moved, so the job writes only rows that changed
 * rather than touching every row every night.
 */
export function resolveSweepUpdate(
  row: SweepableUnsubscribe,
  observation: SweepObservation,
  now: Date
): { messagesSeenAfter: number; lastSeenAfterAt: Date | null; status?: UnsubscribeStatus } | null {
  const pastDeadline =
    now.getTime() - row.requestedAt.getTime() >= UNSUBSCRIBE_IGNORED_AFTER_DAYS * DAY_MS
  const shouldFlip = row.status === 'requested' && pastDeadline && observation.messagesSeenAfter > 0

  const countChanged = observation.messagesSeenAfter !== row.messagesSeenAfter
  const seenChanged =
    (observation.lastSeenAfterAt?.getTime() ?? null) !== (row.lastSeenAfterAt?.getTime() ?? null)

  if (!countChanged && !seenChanged && !shouldFlip) return null

  return {
    messagesSeenAfter: observation.messagesSeenAfter,
    lastSeenAfterAt: observation.lastSeenAfterAt,
    ...(shouldFlip ? { status: 'ignored' as const } : {}),
  }
}

/**
 * Count the inbound mail from one group that landed in one inbox AFTER the
 * unsubscribe request, and when the newest of it landed.
 *
 * Absolute, recounted over the whole `> requestedAt` window every pass, so a
 * retry or an overlapping run converges instead of double-counting. `Message`
 * carries no `inboxId`, so the inbox scope comes from the `Thread` join — the
 * same shape `resolveUnsubscribeTarget` uses, over the same
 * {@link buildSubjectKeyPredicate}, so the count and the offer can never
 * disagree about which mail the group covers.
 */
export async function countMessagesSinceUnsubscribe(
  db: Database,
  row: Pick<SweepableUnsubscribe, 'organizationId' | 'inboxId' | 'subjectKey' | 'requestedAt'>
): Promise<SweepObservation> {
  const [observed] = await db
    .select({
      messages: count(schema.Message.id),
      lastSeenAfterAt: max(schema.Message.receivedAt),
    })
    .from(schema.Message)
    .innerJoin(schema.Thread, eq(schema.Thread.id, schema.Message.threadId))
    .where(
      and(
        eq(schema.Message.organizationId, row.organizationId),
        eq(schema.Thread.inboxId, row.inboxId),
        eq(schema.Message.isInbound, true),
        gt(schema.Message.receivedAt, row.requestedAt),
        buildSubjectKeyPredicate(row.subjectKey)
      )
    )

  return {
    messagesSeenAfter: observed?.messages ?? 0,
    lastSeenAfterAt: observed?.lastSeenAfterAt ?? null,
  }
}

/** Rows loaded per pass — bounds memory and keeps each write short. */
export const UNSUBSCRIBE_SWEEP_BATCH = 500

/**
 * Statuses still worth measuring.
 *
 * `ignored` is terminal (we already concluded they don't honor it) and `failed`
 * means the request never got through — counting THEIR mail against OUR failure
 * would be the wrong attribution.
 */
const OPEN_STATUSES: UnsubscribeStatus[] = ['requested', 'confirmed']

export interface SweepMailUnsubscribesStats {
  scanned: number
  updated: number
  markedIgnored: number
}

export interface SweepMailUnsubscribesOptions {
  /** Injected so the deadline is testable without fake timers. */
  now?: Date
  /** BullMQ cancellation, checked between rows. */
  isCancelled?: () => boolean
  batchSize?: number
}

/**
 * Measure every open unsubscribe against the mail that arrived since, and
 * persist only what moved.
 *
 * Global (all orgs), keyset-paginated by id. Idempotent:
 * {@link countMessagesSinceUnsubscribe} recounts the whole `> requestedAt`
 * window rather than incrementing, so a retry or an overlapping run converges.
 *
 * One row's failure never aborts the sweep — an unparseable subject key or a
 * transient read error is logged and skipped, because every row is independent
 * and losing the whole nightly pass to one bad row is the worse outcome.
 */
export async function sweepMailUnsubscribes(
  db: Database,
  opts: SweepMailUnsubscribesOptions = {}
): Promise<SweepMailUnsubscribesStats> {
  const now = opts.now ?? new Date()
  const batchSize = opts.batchSize ?? UNSUBSCRIBE_SWEEP_BATCH
  const stats: SweepMailUnsubscribesStats = { scanned: 0, updated: 0, markedIgnored: 0 }

  let cursor: string | null = null

  for (;;) {
    const rows: SweepableUnsubscribe[] = await db
      .select({
        id: schema.MailUnsubscribe.id,
        organizationId: schema.MailUnsubscribe.organizationId,
        inboxId: schema.MailUnsubscribe.inboxId,
        subjectKey: schema.MailUnsubscribe.subjectKey,
        requestedAt: schema.MailUnsubscribe.requestedAt,
        status: schema.MailUnsubscribe.status,
        messagesSeenAfter: schema.MailUnsubscribe.messagesSeenAfter,
        lastSeenAfterAt: schema.MailUnsubscribe.lastSeenAfterAt,
      })
      .from(schema.MailUnsubscribe)
      .where(
        and(
          inArray(schema.MailUnsubscribe.status, OPEN_STATUSES),
          ...(cursor ? [gt(schema.MailUnsubscribe.id, cursor)] : [])
        )
      )
      .orderBy(asc(schema.MailUnsubscribe.id))
      .limit(batchSize)

    if (rows.length === 0) break

    for (const row of rows) {
      if (opts.isCancelled?.()) {
        logger.info('Mail-unsubscribe sweep cancelled', stats)
        return stats
      }

      stats.scanned++

      let update: ReturnType<typeof resolveSweepUpdate>
      try {
        update = resolveSweepUpdate(row, await countMessagesSinceUnsubscribe(db, row), now)
      } catch (error) {
        logger.warn('Skipped an unsubscribe row during the sweep', {
          id: row.id,
          organizationId: row.organizationId,
          subjectKey: row.subjectKey,
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      if (!update) continue

      const applied = await applyUnsubscribeSweepObservation(db, row.id, update)
      if (applied.isErr()) {
        logger.warn('Failed to persist an unsubscribe sweep observation', {
          id: row.id,
          error: applied.error.message,
        })
        continue
      }

      stats.updated++
      if (update.status === 'ignored') {
        stats.markedIgnored++
        logger.info('Sender ignored an unsubscribe request', {
          organizationId: row.organizationId,
          inboxId: row.inboxId,
          subjectKey: row.subjectKey,
          messagesSeenAfter: update.messagesSeenAfter,
        })
      }
    }

    cursor = rows[rows.length - 1]!.id
    if (rows.length < batchSize) break
  }

  return stats
}
