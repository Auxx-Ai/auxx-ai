// packages/lib/src/dedup/pairs.ts
//
// Writes for DuplicateSuggestion. Functional Drizzle + neverthrow — no service
// class. Reads live in `blocking.ts` (candidates) and `queries.ts` (the queue).
//
// ZERO permission checks (lib-module-guide §6). What this file enforces is
// INTEGRITY only: org scope, canonical pair ordering, and the status state
// machine. Who may dismiss or merge a pair is the router's question.

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, ne, not, or, type SQL, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { BadRequestError } from '../errors'
import type { ScoredPair } from './scoring'

const T = schema.DuplicateSuggestion

/** `(org, def, low, high)` — the unique-index tuple, as a dedupe key. */
const conflictKey = (p: ScoredPair) =>
  `${p.organizationId}|${p.entityDefinitionId}|${p.instanceIdLow}|${p.instanceIdHigh}`

/**
 * Insert or refresh scored pairs.
 *
 * **Canonical ordering is enforced here.** `instanceIdLow` < `instanceIdHigh` by
 * string comparison is what makes `(A,B)` and `(B,A)` the same row via
 * `DuplicateSuggestion_org_def_pair_key`; a writer that skipped the check would
 * store both directions and the review queue would show every duplicate twice.
 * A mis-ordered or self-referential pair is a programming error, so it is
 * rejected rather than silently sorted.
 *
 * Three properties the conflict clause has to hold at once:
 *
 *  - **`merged` rows are never touched** (`setWhere`). Merge is terminal: a
 *    re-scan that resurrected a merged pair would ask the user to merge records
 *    they already merged.
 *  - **Dismissal is sticky, EXCEPT on a band upgrade.** A pair dismissed at
 *    `medium` that later earns `high` — the records turn out to share an email —
 *    reopens; a re-scored `medium` pair stays dismissed. `dismissedBand` is the
 *    snapshot that makes the distinction possible. Without it, sticky dismissal
 *    either buries strengthened pairs forever or nags on every rescan.
 *  - **A snooze does not survive a band upgrade** either, for the same reason;
 *    the un-snooze is keyed off the row's STORED band so an ordinary rescan at
 *    the same band leaves the snooze alone.
 *
 * Upserts one row at a time (the `upsertMailSuggestions` precedent) rather than
 * one batched statement: the per-row `set` can then use plain values instead of
 * `excluded.*`, and a batch containing the same pair twice cannot trip
 * "ON CONFLICT DO UPDATE command cannot affect row a second time".
 *
 * @returns how many rows were written (a row skipped by `setWhere` counts zero).
 */
export async function upsertPairs(
  db: Database,
  pairs: ScoredPair[]
): Promise<Result<number, Error>> {
  const unique = new Map<string, ScoredPair>()
  for (const pair of pairs) {
    if (pair.instanceIdLow === pair.instanceIdHigh) {
      return err(new BadRequestError('upsertPairs: a record cannot be its own duplicate'))
    }
    if (pair.instanceIdLow >= pair.instanceIdHigh) {
      return err(
        new BadRequestError(
          'upsertPairs: pair is not in canonical order (instanceIdLow must sort before instanceIdHigh)'
        )
      )
    }
    unique.set(conflictKey(pair), pair)
  }

  let written = 0
  for (const pair of unique.values()) {
    // Only `high` can be an upgrade — `medium` is the lowest stored band, so a
    // medium rescan has nothing to reopen and must not disturb status/snooze.
    const reopenOnUpgrade: Record<string, SQL> =
      pair.band === 'high'
        ? {
            status: sql`CASE WHEN ${T.status} = 'dismissed' AND ${T.dismissedBand} = 'medium' THEN 'open' ELSE ${T.status} END`,
            snoozeUntil: sql`CASE WHEN ${T.band} = 'medium' THEN NULL ELSE ${T.snoozeUntil} END`,
          }
        : {}

    const [row] = await db
      .insert(T)
      .values({
        organizationId: pair.organizationId,
        entityDefinitionId: pair.entityDefinitionId,
        instanceIdLow: pair.instanceIdLow,
        instanceIdHigh: pair.instanceIdHigh,
        score: pair.score,
        band: pair.band,
        signals: pair.signals,
        status: 'open',
      })
      .onConflictDoUpdate({
        target: [T.organizationId, T.entityDefinitionId, T.instanceIdLow, T.instanceIdHigh],
        set: {
          score: pair.score,
          band: pair.band,
          signals: pair.signals,
          updatedAt: new Date(),
          ...reopenOnUpgrade,
        },
        setWhere: ne(T.status, 'merged'),
      })
      .returning({ id: T.id })

    if (row) written++
  }

  return ok(written)
}

/** Parameters for {@link rescoreOpenPairsForRecord}. */
export interface RescorePairsParams {
  organizationId: string
  entityDefinitionId: string
  /** `EntityInstance.id` of the record that was just re-scanned. */
  instanceId: string
  /**
   * The COMPLETE freshly-computed pair set for this record. Anything open and
   * touching the record that is absent from this list is treated as stale.
   */
  pairs: ScoredPair[]
}

/**
 * Close the open pairs a re-scan no longer supports.
 *
 * Rescore-on-change is mandatory, not an enhancement: without it the store is
 * upsert-only and a corrected email leaves its duplicate suggestion standing
 * forever. Exact blocking is symmetric — scanning A finds B exactly when
 * scanning B finds A — so the record's own fresh set is a complete statement
 * about every pair it belongs to.
 *
 * Stale pairs are DELETED rather than stamped `dismissed`. The evidence is gone,
 * so there is nothing left to dismiss, and a synthetic dismissal would suppress
 * a genuine future match at the same band (dismissal only reopens on an upgrade).
 *
 * Only `open` rows are considered. A user-`dismissed` row is left alone — it is
 * already hidden, it carries the `dismissedBand` that governs any future reopen,
 * and deleting it would throw away an explicit human decision. `merged` is
 * terminal and never touched.
 *
 * @returns how many stale pairs were closed.
 */
export async function rescoreOpenPairsForRecord(
  db: Database,
  params: RescorePairsParams
): Promise<Result<number, Error>> {
  const { organizationId, entityDefinitionId, instanceId, pairs } = params

  const keepIds = [
    ...new Set(
      pairs
        .filter((p) => p.instanceIdLow === instanceId || p.instanceIdHigh === instanceId)
        .map((p) => (p.instanceIdLow === instanceId ? p.instanceIdHigh : p.instanceIdLow))
    ),
  ]

  // With no fresh pairs the guard collapses to `undefined` and every open pair
  // touching the record is closed — which is exactly right: the evidence for
  // all of them is gone.
  const keepGuard =
    keepIds.length > 0
      ? not(
          or(
            and(eq(T.instanceIdLow, instanceId), inArray(T.instanceIdHigh, keepIds)),
            and(eq(T.instanceIdHigh, instanceId), inArray(T.instanceIdLow, keepIds))
          ) as SQL
        )
      : undefined

  const rows = await db
    .delete(T)
    .where(
      and(
        eq(T.organizationId, organizationId),
        eq(T.entityDefinitionId, entityDefinitionId),
        eq(T.status, 'open'),
        or(eq(T.instanceIdLow, instanceId), eq(T.instanceIdHigh, instanceId)),
        keepGuard
      )
    )
    .returning({ id: T.id })

  return ok(rows.length)
}

/**
 * Delete every `open` pair touching a record — the archive-path cleanup.
 *
 * This is not a new concept: it is exactly what {@link rescoreOpenPairsForRecord}
 * does when a re-scan returns no fresh pairs, scoped to one record and reached
 * from the archive path instead of the scan path. **Deletion is how an `open`
 * pair goes away**; `dismissed` and `merged` are the only persisted terminal
 * states.
 *
 * Why archive cleans up rather than merely hiding: in this product "delete" IS
 * archive (`unified-handler-mutations.ts` sets `archivedAt`; the only true
 * `db.delete(EntityInstance)` is for entity groups), so the FK cascade
 * essentially never fires for real records. Leaving the rows would accumulate
 * `open` pairs forever behind a join that exists purely to hide them — and the
 * "unarchive brings the pair back for free" argument rests on a path users
 * cannot reach (`api.record.restore` has exactly one UI caller, and it is the
 * tag list).
 *
 * Two rows this must NOT touch:
 *  - **`dismissed`** — it carries the `dismissedBand` that governs reopen. Delete
 *    it and a genuine future re-match at the same band nags again from scratch.
 *  - **`merged`** — terminal, and the audit trail that this suggestion led
 *    somewhere.
 *
 * Read paths still filter archived on BOTH sides regardless. This is hygiene,
 * not the invariant: write-path hooks in this codebase get bypassed routinely
 * (`skipEvents`, bulk paths, direct writes), so correctness must never depend on
 * one having run.
 *
 * No restore hook is needed as the counterpart. `EntityInstance.updatedAt`
 * carries `$onUpdate`, so restoring re-dirties the record against
 * `lastDuplicateScanAt` and the next watermark scan recreates any pair that
 * still qualifies.
 *
 * @returns how many open pairs were deleted.
 */
export async function deleteOpenPairsForRecord(
  db: Database,
  organizationId: string,
  instanceId: string
): Promise<Result<number, Error>> {
  const rows = await db
    .delete(T)
    .where(
      and(
        eq(T.organizationId, organizationId),
        eq(T.status, 'open'),
        or(eq(T.instanceIdLow, instanceId), eq(T.instanceIdHigh, instanceId))
      )
    )
    .returning({ id: T.id })

  return ok(rows.length)
}

/** Parameters for {@link dismissPair}. */
export interface DismissPairParams {
  organizationId: string
  /** `DuplicateSuggestion.id`. The caller must already have proven it is visible. */
  pairId: string
  /** Who acted — stamped so the queue can say who buried a pair. */
  userId: string
  /**
   * Present ⇒ SNOOZE instead of dismiss. Snoozed is `open` plus a future
   * `snoozeUntil`, so the pair returns to the queue on its own with no sweep.
   */
  snoozeUntil?: Date
}

/**
 * Dismiss or snooze one pair — the only user-facing write on the queue.
 *
 * **`dismissedBand` is stamped from the row's OWN stored band**, read inside the
 * same statement rather than passed in by the caller. That column is what makes
 * reopen-on-upgrade safe (`upsertPairs`), and a caller-supplied band would let a
 * stale client snapshot decide whether a future `high` re-match is allowed to
 * nag — the one field where trusting the client silently breaks the state
 * machine.
 *
 * Snoozing deliberately does NOT stamp `dismissedBand`: a snooze is "not now",
 * not a decision about the evidence, and stamping it would make the next
 * band upgrade un-noticeable for that pair.
 *
 * `merged` rows are never touched — merge is terminal.
 *
 * @returns `true` when a row was written; `false` when the id matched nothing
 *          eligible (already merged, or not in this org).
 */
export async function dismissPair(
  db: Database,
  params: DismissPairParams
): Promise<Result<boolean, Error>> {
  const { organizationId, pairId, userId, snoozeUntil } = params

  const set = snoozeUntil
    ? { snoozeUntil, updatedAt: new Date() }
    : {
        status: 'dismissed',
        dismissedByUserId: userId,
        dismissedAt: new Date(),
        // `T.band` — the row's stored band, not the caller's idea of it.
        dismissedBand: sql`${T.band}`,
        snoozeUntil: null,
        updatedAt: new Date(),
      }

  const rows = await db
    .update(T)
    .set(set)
    .where(and(eq(T.organizationId, organizationId), eq(T.id, pairId), ne(T.status, 'merged')))
    .returning({ id: T.id })

  return ok(rows.length > 0)
}

/** Outcome of {@link resolveSuggestionsForMerge}. */
export interface MergeResolution {
  /** Pairs entirely inside the merge set, stamped `merged`. */
  merged: number
  /** Other open/dismissed pairs touching an archived source, deleted. */
  closed: number
}

/**
 * Resolve a record merge's duplicate suggestions — **call inside the merge
 * transaction**.
 *
 * Merge ARCHIVES the sources (a soft delete), so the FK cascade never fires and
 * the pairs survive unless this runs. It takes a `Transaction` rather than a
 * `Database` for that reason: if the merge rolls back, so must the resolution,
 * or the suggestion queue would report a merge that did not happen.
 * (`touchEntityActivity` is the in-file precedent for a tx-taking side effect.)
 *
 * Two different outcomes, deliberately:
 *  - a pair whose BOTH sides are in the merge set was the suggestion the user
 *    acted on → `merged`, which is terminal and preserves the record that this
 *    suggestion led somewhere;
 *  - any other pair touching a source is deleted. It was never acted on, and its
 *    surviving side may well still duplicate the merge TARGET — but that is a
 *    fact for the target's next scan to establish, not one to migrate blindly.
 *
 * Already-`merged` rows are never touched.
 */
export async function resolveSuggestionsForMerge(
  tx: Transaction,
  organizationId: string,
  targetInstanceId: string,
  sourceInstanceIds: string[]
): Promise<Result<MergeResolution, Error>> {
  if (sourceInstanceIds.length === 0) return ok({ merged: 0, closed: 0 })

  const inMergeSet = [...new Set([targetInstanceId, ...sourceInstanceIds])]

  const mergedRows = await tx
    .update(T)
    .set({ status: 'merged', updatedAt: new Date() })
    .where(
      and(
        eq(T.organizationId, organizationId),
        ne(T.status, 'merged'),
        inArray(T.instanceIdLow, inMergeSet),
        inArray(T.instanceIdHigh, inMergeSet)
      )
    )
    .returning({ id: T.id })

  const closedRows = await tx
    .delete(T)
    .where(
      and(
        eq(T.organizationId, organizationId),
        ne(T.status, 'merged'),
        or(
          inArray(T.instanceIdLow, sourceInstanceIds),
          inArray(T.instanceIdHigh, sourceInstanceIds)
        )
      )
    )
    .returning({ id: T.id })

  return ok({ merged: mergedRows.length, closed: closedRows.length })
}
