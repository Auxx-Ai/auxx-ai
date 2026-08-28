// packages/lib/src/reconcilers/__tests__/dirty-parents-transaction.int.test.ts
//
// DB-backed tests (vitest.integration.config.ts -> auxx_test) for the one claim
// `dirty-parents.test.ts` structurally cannot make: that the two exits in plan 08
// §8 Q1 behave correctly against a REAL transaction.
//
// The 20 unit tests next door drive `runWithDirtyParents` with a fake
// `TxWriteScope` and a recording drain. That proves the buffer's bookkeeping —
// coalescing, joining, the one-pass rule — and nothing at all about WHEN the
// drain runs relative to COMMIT. A version that drained in place, mid-transaction
// on the pooled connection, would satisfy every one of them and would silently
// reconcile against rows nobody can see yet. That is the same class of gap
// `plans/products/build/README.md` §6 O4 raised for `completeBuild`, which #1951
// closed with a live-database test; this is the layer above it.
//
// Four things are asserted here that no double can see:
//
//   1. **The drain does not run before COMMIT**, and when it does run it observes
//      committed state — proven by having the drain read the row on a DIFFERENT
//      connection from the one that wrote it.
//   2. **A rolled-back transaction drains nothing**, and `runInTxWrite`'s
//      per-attempt contract is what makes that structural rather than careful:
//      the rejected promise carries no scope, so a caller CANNOT flush an attempt
//      that rolled back.
//   3. **A committed transaction drains exactly once**, unioning every write
//      method inside it.
//   4. **The non-transactional path** drains on the way out of the outermost
//      scope, and nested scopes join rather than draining twice.
//
// Nothing in `reconcilers/dirty-parents.ts`, `tx-write-scope.ts` or
// `tx-write-flush.ts` is modified or stubbed. The only mock is realtime — see
// below — and it is infrastructure, not a seam under test.

import { schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { eq, inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushTxWriteScope } from '../../resources/crud/tx-write-flush'
import { runInTxWrite, type TxWriteScope } from '../../resources/crud/tx-write-scope'
import {
  __resetReconcilersForTest,
  markParentDirty,
  registerReconciler,
  runWithDirtyParents,
} from '../dirty-parents'

// ── Realtime, mocked OFF ─────────────────────────────────────────────────────
//
// ⚠️ Not decoration. `flushTxWriteScope` acquires the realtime service before it
// replays anything, and the service is Redis-backed; BullMQ/ioredis default to
// `maxRetriesPerRequest: null`, so a command issued against an unreachable Redis
// never settles and the suite hangs rather than failing. Same trap
// `complete-build-transaction.int.test.ts` documents for `publishLater`.
//
// This does NOT weaken the claims below. The scopes here carry no creates, no
// field changes and no archives — the writes are raw inserts, not
// `UnifiedCrudHandler` calls — so the replay half of the flush has nothing to
// publish either way. `dirtyParents` is drained in its own guarded block AFTER
// the replay (`tx-write-flush.ts`), which is exactly the ordering under test.

vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({
    publish: async () => {},
    publishLater: async () => {},
  }),
}))

const db = () => getTestDb()

/** The reconciler key these tests register under. */
const KEY = 'int-test:dirty-parents'

/** One drain invocation: the batch it was handed, and what it could SEE. */
interface DrainCall {
  parentInstanceIds: string[]
  /** `displayName` as read on the POOL, per id — `null` when the row is invisible. */
  visible: Array<string | null>
}

let drainCalls: DrainCall[] = []
let organizationId: string
let userId: string
let entityDefinitionId: string

/**
 * Register a drain that READS.
 *
 * The read is the whole point and it is deliberately issued through
 * `getTestDb()` — the pooled connection — never through the `tx` handle that
 * wrote the row. A drain that ran inside the transaction would find nothing
 * there, so a non-null `displayName` is positive proof the write had committed
 * by the time the drain ran.
 */
function registerRecordingDrain(): void {
  drainCalls = []
  registerReconciler(KEY, async ({ parentInstanceIds }) => {
    const rows = await db()
      .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
      .from(schema.EntityInstance)
      .where(inArray(schema.EntityInstance.id, parentInstanceIds))
    const byId = new Map(rows.map((r) => [r.id, r.displayName]))
    drainCalls.push({
      parentInstanceIds,
      visible: parentInstanceIds.map((id) => byId.get(id) ?? null),
    })
  })
}

/** An `EntityInstance` id that does not exist yet. */
function newParentId(suffix: string): string {
  return `int_dp_${suffix}_${Math.random().toString(36).slice(2, 10)}`
}

/** Insert one instance on the given handle (a `tx`, or the pool). */
async function insertParent(
  handle: { insert: ReturnType<typeof getTestDb>['insert'] },
  id: string,
  displayName: string
): Promise<void> {
  await handle.insert(schema.EntityInstance).values({
    id,
    organizationId,
    entityDefinitionId,
    displayName,
    updatedAt: new Date(),
  })
}

/** Does the row exist on the pool? */
async function rowExists(id: string): Promise<boolean> {
  const rows = await db()
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(eq(schema.EntityInstance.id, id))
  return rows.length > 0
}

beforeEach(async () => {
  __resetReconcilersForTest()
  registerRecordingDrain()

  const org = await createTestOrganization()
  const user = await createTestUser({ name: 'Reconciler' })
  organizationId = org.id
  userId = user.id

  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId,
      entityType: null,
      apiSlug: 'dirty-parent-probes',
      singular: 'Probe',
      plural: 'Probes',
      icon: 'box',
      color: 'blue',
      isVisible: true,
      updatedAt: new Date(),
    })
    .returning()
  if (!def) throw new Error('failed to seed the probe entity definition')
  entityDefinitionId = def.id
})

describe('the transaction exit — the drain lands after COMMIT', () => {
  it('does not drain while the transaction is still open, and then sees the committed row', async () => {
    const parentId = newParentId('commit')
    let scope: TxWriteScope | undefined
    let drainsSeenInsideTx = -1

    await db().transaction(async (tx) => {
      const outcome = await runInTxWrite({ organizationId, actorUserId: userId }, async () => {
        await runWithDirtyParents(organizationId, userId, async () => {
          await insertParent(tx, parentId, 'committed')
          markParentDirty(KEY, parentId)
        })
        // `runWithDirtyParents` has RETURNED by now — under a drain-in-place
        // design this is exactly where the reconciler would have run, against a
        // row no other connection can see.
        drainsSeenInsideTx = drainCalls.length
      })
      scope = outcome.scope
    })

    expect(drainsSeenInsideTx).toBe(0)
    // Handed to the transaction buffer instead of being drained.
    expect([...(scope?.dirtyParents.get(KEY) ?? [])]).toEqual([parentId])
    expect(drainCalls).toHaveLength(0)

    await flushTxWriteScope(scope as TxWriteScope)

    expect(drainCalls).toHaveLength(1)
    expect(drainCalls[0]?.parentInstanceIds).toEqual([parentId])
    // The proof: the drain read the row on the POOL and found it. Mid-transaction
    // this would have been `null`.
    expect(drainCalls[0]?.visible).toEqual(['committed'])
  })

  it('drains exactly once for the union of every write method in the transaction', async () => {
    const first = newParentId('union1')
    const second = newParentId('union2')
    let scope: TxWriteScope | undefined

    await db().transaction(async (tx) => {
      const outcome = await runInTxWrite({ organizationId, actorUserId: userId }, async () => {
        // Two separate "write methods", each opening and closing its own scope.
        await runWithDirtyParents(organizationId, userId, async () => {
          await insertParent(tx, first, 'first')
          markParentDirty(KEY, first)
        })
        await runWithDirtyParents(organizationId, userId, async () => {
          await insertParent(tx, second, 'second')
          markParentDirty(KEY, second)
        })
        // The second scope must not have drained the first one's parent either.
        expect(drainCalls).toHaveLength(0)
      })
      scope = outcome.scope
    })

    await flushTxWriteScope(scope as TxWriteScope)

    expect(drainCalls).toHaveLength(1)
    expect(drainCalls[0]?.parentInstanceIds).toEqual([first, second])
    expect(drainCalls[0]?.visible).toEqual(['first', 'second'])
  })

  it('coalesces a parent marked by two different write methods into one id', async () => {
    const parentId = newParentId('dedupe')
    let scope: TxWriteScope | undefined

    await db().transaction(async (tx) => {
      const outcome = await runInTxWrite({ organizationId, actorUserId: userId }, async () => {
        await runWithDirtyParents(organizationId, userId, async () => {
          await insertParent(tx, parentId, 'once')
          markParentDirty(KEY, parentId)
        })
        await runWithDirtyParents(organizationId, userId, async () => {
          markParentDirty(KEY, parentId)
        })
      })
      scope = outcome.scope
    })

    await flushTxWriteScope(scope as TxWriteScope)

    expect(drainCalls).toHaveLength(1)
    expect(drainCalls[0]?.parentInstanceIds).toEqual([parentId])
  })
})

describe('the rollback — a rolled-back attempt reconciles nothing', () => {
  it('drains nothing when the transaction throws after the marked write', async () => {
    const parentId = newParentId('rollback')

    await expect(
      db().transaction(async (tx) => {
        await runInTxWrite({ organizationId, actorUserId: userId }, async () => {
          await runWithDirtyParents(organizationId, userId, async () => {
            await insertParent(tx, parentId, 'never-committed')
            markParentDirty(KEY, parentId)
          })
        })
        throw new Error('rolled back on purpose')
      })
    ).rejects.toThrow('rolled back on purpose')

    expect(drainCalls).toHaveLength(0)
    // And the write really did roll back, so a drain would have been reconciling
    // against a row that does not exist.
    expect(await rowExists(parentId)).toBe(false)
  })

  it('gives the caller no scope to flush — the per-attempt contract, structurally', async () => {
    const parentId = newParentId('noscope')
    let scope: TxWriteScope | undefined

    await expect(
      db().transaction(async (tx) => {
        // `runInTxWrite` rejects, so the assignment below never happens. That is
        // T-5 rule 3: a rejected promise carries no scope, so `flushTxWriteScope`
        // is unreachable for a rolled-back attempt rather than merely unwise.
        const outcome = await runInTxWrite({ organizationId, actorUserId: userId }, async () => {
          await runWithDirtyParents(organizationId, userId, async () => {
            await insertParent(tx, parentId, 'never-committed')
            markParentDirty(KEY, parentId)
          })
          throw new Error('failed inside the composition')
        })
        scope = outcome.scope
      })
    ).rejects.toThrow('failed inside the composition')

    expect(scope).toBeUndefined()
    expect(drainCalls).toHaveLength(0)
    expect(await rowExists(parentId)).toBe(false)
  })

  it('drains nothing when the failure happens INSIDE the write method', async () => {
    const parentId = newParentId('innerthrow')

    await expect(
      db().transaction(async (tx) => {
        await runInTxWrite({ organizationId, actorUserId: userId }, async () => {
          await runWithDirtyParents(organizationId, userId, async () => {
            await insertParent(tx, parentId, 'never-committed')
            markParentDirty(KEY, parentId)
            throw new Error('failed mid-write')
          })
        })
      })
    ).rejects.toThrow('failed mid-write')

    // The scope never reached its handoff either — nothing was buffered anywhere.
    expect(drainCalls).toHaveLength(0)
    expect(await rowExists(parentId)).toBe(false)
  })
})

describe('the non-transactional exit', () => {
  it('drains on the way out of the outermost scope, seeing the committed write', async () => {
    const parentId = newParentId('notx')
    let drainsSeenInside = -1

    await runWithDirtyParents(organizationId, userId, async () => {
      await insertParent(db(), parentId, 'pool-write')
      markParentDirty(KEY, parentId)
      drainsSeenInside = drainCalls.length
    })

    expect(drainsSeenInside).toBe(0)
    expect(drainCalls).toHaveLength(1)
    expect(drainCalls[0]?.parentInstanceIds).toEqual([parentId])
    expect(drainCalls[0]?.visible).toEqual(['pool-write'])
  })

  it('joins nested scopes into ONE drain rather than draining twice', async () => {
    const outer = newParentId('outer')
    const inner = newParentId('inner')

    await runWithDirtyParents(organizationId, userId, async () => {
      await insertParent(db(), outer, 'outer')
      markParentDirty(KEY, outer)

      // A hook that constructs its own handler mid-write.
      await runWithDirtyParents(organizationId, userId, async () => {
        await insertParent(db(), inner, 'inner')
        markParentDirty(KEY, inner)
      })

      // If the inner scope had drained on its own way out, this would be 1.
      expect(drainCalls).toHaveLength(0)
    })

    expect(drainCalls).toHaveLength(1)
    expect(drainCalls[0]?.parentInstanceIds).toEqual([outer, inner])
    expect(drainCalls[0]?.visible).toEqual(['outer', 'inner'])
  })

  it('does not drain when the write throws', async () => {
    const parentId = newParentId('notx-throw')

    await expect(
      runWithDirtyParents(organizationId, userId, async () => {
        await insertParent(db(), parentId, 'written-then-threw')
        markParentDirty(KEY, parentId)
        throw new Error('write failed')
      })
    ).rejects.toThrow('write failed')

    // ⚠️ Note what this does NOT claim. Outside a transaction the insert is
    // already committed and stays — `runWithDirtyParents` provides no atomicity,
    // only the guarantee that it will not reconcile behind a failed write. The
    // row surviving here is the honest shape of the non-transactional path.
    expect(drainCalls).toHaveLength(0)
    expect(await rowExists(parentId)).toBe(true)
  })
})
