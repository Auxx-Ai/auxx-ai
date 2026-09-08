// packages/lib/src/turn-scoped/turn-slot.ts

/**
 * The Redis mechanics behind a per-turn pre-edit snapshot - SERVER-ONLY.
 *
 * This is the shared half of what `workflows/graph-edit/turn-snapshot.ts`,
 * `kb/kopilot-snapshot.ts` and `dashboards/draft-edit/turn-snapshot.ts` each
 * used to implement for themselves. Only two things ever differed between
 * them: the payload type, and the domain-specific revert. Everything below was
 * copied, and by the third copy the discipline had already drifted (KB's
 * capture overwrites unconditionally and pushes the once-per-turn check onto
 * its caller; the workflow's does not).
 *
 * WHAT THIS DELIBERATELY DOES NOT OWN: the revert. Restoring a graph, an
 * article body or a layout doc means loading the subject, comparing a
 * domain-specific staleness token and writing through that domain's own persist
 * seam. That stays in each domain module, next to the docblocks explaining what
 * its guarantees protect.
 *
 * WHY IT LIVES AT THE LIB ROOT and not under `ai/kopilot/`: `graph-edit` is a
 * headless draft-editing module whose own docblock records that it must not
 * take a dependency on `ai/agent-framework` merely to name three strings. A
 * generic Redis slot has no business dragging the AI barrel into `workflows/`,
 * `kb/` or `dashboards/`. This module depends on `@auxx/redis` and
 * `@auxx/logger` and nothing else.
 *
 * No permission checks live here (house rule). Every caller has already
 * asserted edit access at its capability or router layer.
 *
 * ## The four invariants
 *
 * Each one is load-bearing and each was arrived at by something breaking. They
 * are implemented once, here, so a fourth domain cannot get one subtly wrong.
 *
 * 1. **Capture is idempotent within a turn.** A second write in the same turn
 *    must not bump the snapshot, or whole-turn Undo silently degrades to
 *    undo-the-last-edit. A snapshot from a PRIOR turn is overwritten: the new
 *    turn supersedes it.
 * 2. **Every read and write is turn-checked.** A stale turn must never read,
 *    relabel, or delete a fresher turn's snapshot. `read` returning null for a
 *    turn id IS the "did this turn write anything" record.
 * 3. **`patch` refreshes the TTL, `finalize` deletes, `clear` deletes
 *    unconditionally.** Only `finalize` and `clear` remove anything, and only
 *    `clear` skips the turn check (it is the non-agent write path saying "the
 *    subject moved under you").
 * 4. **Best-effort where it must not break a turn, propagating where the caller
 *    must know.** `patch` / `finalize` / `clear` swallow and log: they run on
 *    turn-end and cleanup paths whose one job is to leave the recovery route
 *    intact. `capture` and `read` propagate, because a caller that thinks it
 *    captured a snapshot when it did not is worse than a failed mutation.
 */

import { createScopedLogger } from '@auxx/logger'
import { deleteRedisData, getRedisData, setRedisData } from '@auxx/redis'

/** The one field every turn-scoped record must carry, so the slot can check it. */
export interface TurnScopedRecord {
  turnId: string
}

export interface TurnSlotOptions {
  /** Builds the Redis key for a subject, e.g. `` (id) => `kb:article:${id}:preturn` ``. */
  key: (subjectId: string) => string
  /** Slot lifetime. The backstop for a server that dies mid-turn. */
  ttlSeconds: number
  /** Logger scope, e.g. `'workflow-turn-snapshot'`. */
  logScope: string
}

export interface TurnSlot<T extends TurnScopedRecord> {
  /**
   * Store `record` for its turn. Returns **true only when it actually wrote** -
   * false means the slot already held THIS turn's record and was left untouched
   * (invariant 1). A prior turn's record is overwritten.
   *
   * Propagates Redis failures (invariant 4).
   */
  capture(subjectId: string, record: T): Promise<boolean>

  /**
   * Read the current record. Pass `expectedTurnId` to verify ownership: the
   * call returns null when the stored record belongs to a different (newer)
   * turn, which is how a stale caller detects it was superseded.
   *
   * Null also means "this turn never wrote anything". The two are deliberately
   * indistinguishable - neither has anything to recover.
   *
   * Propagates Redis failures (invariant 4).
   */
  read(subjectId: string, expectedTurnId?: string): Promise<T | null>

  /**
   * Merge `fields` into this turn's record and refresh the TTL. Turn-checked,
   * so a stale turn relabels nothing. A patch whose every field already holds
   * its target value is a no-op, so it neither writes nor extends the TTL.
   *
   * ADDITIVE ONLY - it cannot delete the record. This is what stamps a
   * post-turn hash after each write, and how the turn ended at turn end.
   *
   * Best-effort: swallows and logs (invariant 4).
   */
  patch(subjectId: string, turnId: string, fields: Partial<Omit<T, 'turnId'>>): Promise<void>

  /**
   * Discard this turn's record, turn-checked. "The turn committed, there is
   * nothing left to recover."
   *
   * Best-effort: a leftover record expires via TTL, and the turn check on the
   * read path refuses it anyway.
   */
  finalize(subjectId: string, turnId: string): Promise<void>

  /**
   * Delete the record unconditionally, **no turn check**. For non-agent write
   * paths (a manual save, a publish, a version restore) so a late recovery can
   * never roll the subject back over edits made by hand.
   *
   * Best-effort.
   */
  clear(subjectId: string): Promise<void>
}

/**
 * Build a turn-scoped Redis slot. One slot per subject: each new turn
 * overwrites the prior turn's record, and the record expires on its own.
 */
export function createTurnSlot<T extends TurnScopedRecord>(options: TurnSlotOptions): TurnSlot<T> {
  const { key, ttlSeconds, logScope } = options
  const logger = createScopedLogger(logScope)

  const load = async (subjectId: string): Promise<T | null> =>
    ((await getRedisData(key(subjectId))) as T | null) ?? null

  return {
    async capture(subjectId, record) {
      const existing = await load(subjectId)
      if (existing?.turnId === record.turnId) return false
      await setRedisData(key(subjectId), record, ttlSeconds)
      return true
    },

    async read(subjectId, expectedTurnId) {
      const raw = await load(subjectId)
      if (!raw) return null
      if (expectedTurnId && raw.turnId !== expectedTurnId) return null
      return raw
    },

    async patch(subjectId, turnId, fields) {
      try {
        const existing = await load(subjectId)
        if (existing?.turnId !== turnId) return
        // Nothing to say. Skipping the write is not just an optimization: a
        // re-`setex` refreshes the TTL, so a no-op patch would silently extend
        // how long a record outlives its turn.
        const entries = Object.entries(fields) as Array<[keyof T, T[keyof T]]>
        if (entries.every(([field, value]) => existing[field] === value)) return
        await setRedisData(key(subjectId), { ...existing, ...fields }, ttlSeconds)
      } catch (error) {
        logger.warn('Failed to patch turn slot', {
          subjectId,
          turnId,
          fields: Object.keys(fields),
          error: (error as Error).message,
        })
      }
    },

    async finalize(subjectId, turnId) {
      try {
        const existing = await load(subjectId)
        if (existing?.turnId !== turnId) return
        await deleteRedisData(key(subjectId))
      } catch (error) {
        logger.warn('Failed to finalize turn slot', {
          subjectId,
          turnId,
          error: (error as Error).message,
        })
      }
    },

    async clear(subjectId) {
      try {
        await deleteRedisData(key(subjectId))
      } catch (error) {
        logger.warn('Failed to clear turn slot', {
          subjectId,
          error: (error as Error).message,
        })
      }
    },
  }
}
