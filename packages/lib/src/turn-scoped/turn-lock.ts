// packages/lib/src/turn-scoped/turn-lock.ts

/**
 * The Redis mechanics behind a "a Kopilot turn is open on this subject" marker
 * - SERVER-ONLY. Shared half of `workflows/graph-edit/turn-lock.ts` and
 * `dashboards/draft-edit/turn-lock.ts`.
 *
 * WHAT IT DOES NOT OWN: the announcement. `begin` / `end` (acquire-then-publish,
 * release-then-publish) stay in each domain module because the realtime event
 * is domain-specific, and because the lazy realtime import that keeps `vi.mock`
 * working at collection time has to live next to the domain's own event.
 *
 * ## The three invariants
 *
 * 1. **Acquire is atomic and edge-triggered.** `SET NX EX` in one call, never a
 *    read-then-write, so two concurrent turns on one subject cannot both see an
 *    empty slot and both announce a start. It returns true **only on the
 *    transition** - the first tool call of a turn - which is what makes it a
 *    correct trigger for a `started` publish. Every later call in the same turn
 *    returns false.
 * 2. **Release is turn-checked.** A stale turn's turn-end must never unlock the
 *    subject underneath a turn that is still writing. The return value says
 *    whether this turn actually held it, so the caller can skip publishing an
 *    `ended` nobody is waiting for.
 * 3. **Fail open, everywhere.** An unreachable Redis leaves the canvas
 *    EDITABLE. A stranded read-only canvas recoverable only by reload is a
 *    worse failure than the race this prevents, and the domain's own hash-CAS
 *    is the real correctness guard underneath.
 *
 * The stored value doubles as the queryable "is a turn open?" record, so a
 * client that missed the release (socket drop, reconnect after the turn ended)
 * can re-derive instead of trusting a local flag it can no longer verify.
 *
 * No permission checks live here (house rule).
 */

import { createScopedLogger } from '@auxx/logger'
import { deleteRedisData, getRedisClient, getRedisData } from '@auxx/redis'

/** A turn currently holding a subject. */
export interface TurnLockRecord {
  turnId: string
  startedAt: number
}

export interface TurnLockOptions {
  /** Builds the Redis key, e.g. `` (id) => `workflow:kopilot:turn:${id}` ``. */
  key: (subjectId: string) => string
  /**
   * Backstop for a server that dies between acquire and release (deploy, crash,
   * OOM). Without it the key outlives the turn and holds the canvas read-only
   * until someone clears Redis by hand. Should be generous relative to a real
   * turn, because an approval pause keeps a turn legitimately open while the
   * user decides; the client-side watchdog is the faster of the two safety
   * nets, and this one exists so the SERVER's record can never be permanently
   * wrong.
   */
  ttlSeconds: number
  /** Logger scope, e.g. `'workflow-turn-lock'`. */
  logScope: string
}

export interface TurnLock {
  /** Claim the subject for `turnId`. True only on the acquiring transition. */
  acquire(subjectId: string, turnId: string): Promise<boolean>
  /** The open turn for a subject, if any. Backs the client's re-derive. */
  read(subjectId: string): Promise<TurnLockRecord | null>
  /** Release, turn-checked. Returns whether this turn actually held it. */
  release(subjectId: string, turnId: string): Promise<boolean>
}

/** Build a per-subject turn lock. See the file docblock for the invariants. */
export function createTurnLock(options: TurnLockOptions): TurnLock {
  const { key, ttlSeconds, logScope } = options
  const logger = createScopedLogger(logScope)

  return {
    async acquire(subjectId, turnId) {
      try {
        // `false` = not required: a missing client returns undefined rather
        // than throwing, which is the fail-open path (invariant 3).
        const client = await getRedisClient(false)
        if (!client) return false
        const record: TurnLockRecord = { turnId, startedAt: Date.now() }
        const claimed = await client.set(
          key(subjectId),
          JSON.stringify(record),
          'EX',
          ttlSeconds,
          'NX'
        )
        return !!claimed
      } catch (error) {
        logger.warn('Failed to acquire turn lock', {
          subjectId,
          turnId,
          error: (error as Error).message,
        })
        return false
      }
    },

    async read(subjectId) {
      try {
        return ((await getRedisData(key(subjectId))) as TurnLockRecord | null) ?? null
      } catch (error) {
        logger.warn('Failed to read turn lock', {
          subjectId,
          error: (error as Error).message,
        })
        return null
      }
    },

    async release(subjectId, turnId) {
      try {
        const existing = (await getRedisData(key(subjectId))) as TurnLockRecord | null
        if (existing?.turnId !== turnId) return false
        await deleteRedisData(key(subjectId))
        return true
      } catch (error) {
        logger.warn('Failed to release turn lock', {
          subjectId,
          turnId,
          error: (error as Error).message,
        })
        return false
      }
    },
  }
}
