// packages/lib/src/inventory/builds/__tests__/complete-build-transaction.int.test.ts
//
// DB-backed tests (vitest.integration.config.ts -> auxx_test) for the ONE claim
// `complete-build.test.ts` structurally cannot make: that every write inside
// `db.transaction()` actually lands on `tx`, and that they all land or none of
// them do.
//
// The unit tests double `db.transaction`, so they observe the calls a fake
// handler received. That proves the ORDER of the steps and nothing about the
// connection they ran on — a `completeBuild` that wrote its movements through
// the module-level pool instead of `tx` would satisfy every one of them, and
// would leave a half-posted build behind the first time anything threw. A
// partial build is a corrupt ledger: consume rows with no produce row value
// inventory out of existence, and no reversal can describe a run that never
// finished.
//
// Three things are asserted here that nothing else can see:
//
//   1. **Commit.** After a completion, all N consume rows and the single
//      produce row are in the database, priced from the frozen standard.
//   2. **Rollback.** A failure raised after the movement writes leaves NOTHING
//      behind — no movement rows, and a build still reading `in_progress`.
//   3. **The post-commit settle sees committed rows.** `settleStockMovements`
//      runs on the module-level pool after the transaction returns, so the
//      quantity on hand it writes is the proof the rows were visible to a
//      different connection by then.
//
// The pool probe after the batched write (`freshReadOutcomes`) is what shows the rows are on `tx`.

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { and, eq, inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrgCache } from '../../../cache'
import { createBuild, startBuild } from '../build-mutations'
import { getBuild } from '../build-queries'
import { completeBuild } from '../complete-build'
import { type BuildFixture, seedBuildOrg } from './support/build-fixture'

const db = () => getTestDb() as unknown as Database

// ── The two queue-backed externals, mocked OFF ───────────────────────────────
//
// BullMQ writes against an unreachable Redis never settle, so these would hang the suite rather
// than fail it. The fixture's part writes go through the field chain, which reaches both.

vi.mock('../../../events/publisher', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, publisher: { publish: async () => {}, publishLater: async () => {} } }
})

vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../dedup/enqueue-scan')>()
  return { ...actual, enqueueDuplicateScan: async () => {} }
})

// ── The two seams the tests steer, both partial mocks ────────────────────────

const h = vi.hoisted(() => ({
  /**
   * Armed only around the call under test: the build's posting throws, after every movement
   * and the build update were written inside the transaction — a failure partway through.
   */
  failPosting: false,
  /** Every movement the batched writer returned, probed through the pool: was it visible there? */
  freshReadOutcomes: [] as Array<{ id: string; found: boolean }>,
  /** Every realtime frame, at the service boundary. */
  frames: [] as Array<{ roomKey: string; event: string; data: unknown }>,
}))

vi.mock('../../../realtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../realtime')>()
  const service = {
    publish: async (roomKey: string, event: string, data: unknown) => {
      h.frames.push({ roomKey, event, data })
      return true
    },
  }
  return { ...actual, getRealtimeService: () => service }
})

vi.mock('../../../accounting/ledger/post/post-inventory-movement', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../accounting/ledger/post/post-inventory-movement')>()
  return {
    ...actual,
    postInventoryMovementInTx: (...args: Parameters<typeof actual.postInventoryMovementInTx>) => {
      if (h.failPosting) {
        throw new Error('injected failure after the movement rows were written')
      }
      return actual.postInventoryMovementInTx(...args)
    },
  }
})

vi.mock('../../movements/write-movements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../movements/write-movements')>()
  return {
    ...actual,
    // Probe each written row through the MODULE-LEVEL pool, a different connection from `tx`.
    writeStockMovements: async (...args: Parameters<typeof actual.writeStockMovements>) => {
      const result = await actual.writeStockMovements(...args)
      if (result.isOk()) {
        const ids = result.value.records.map((record) => record.id)
        const seen = await db()
          .select({ id: schema.StockMovement.id })
          .from(schema.StockMovement)
          .where(inArray(schema.StockMovement.id, ids))
        for (const id of ids) {
          h.freshReadOutcomes.push({ id, found: seen.some((row) => row.id === id) })
        }
      }
      return result
    },
  }
})

// ── Fixture ──────────────────────────────────────────────────────────────────

const QUANTITY_PRODUCED = 10

let f: BuildFixture

/** Raise a build and start it, so `completeBuild` has something legal to finish. */
async function anInProgressBuild(): Promise<string> {
  const created = await createBuild(db(), f.organizationId, f.userId, {
    partId: f.producedPartId,
    quantityPlanned: QUANTITY_PRODUCED,
  })
  if (created.isErr()) throw created.error
  const buildId = created.value.buildId

  const started = await startBuild(db(), f.organizationId, f.userId, { buildId })
  if (started.isErr()) throw started.error
  return buildId
}

/** Every `StockMovement` row in the org. */
async function movementRows() {
  return db()
    .select()
    .from(schema.StockMovement)
    .where(eq(schema.StockMovement.organizationId, f.organizationId))
}

async function movementInstanceIds(): Promise<string[]> {
  return (await movementRows()).map((row) => row.id)
}

/** `systemAttribute` -> `CustomField.id`, straight off the org cache. */
async function fieldId(attribute: string): Promise<string> {
  const fields = await getOrgCache()
    .from(f.organizationId, 'customFields')
    .bySystemAttributes([attribute] as never)
  const field = (fields as Record<string, { id: string } | null>)[attribute]
  if (!field) throw new Error(`no CustomField for ${attribute}`)
  return field.id
}

/** The stored numeric value of `attribute` on each of `entityIds`. */
async function numbersByEntity(
  attribute: string,
  entityIds: string[]
): Promise<Map<string, number>> {
  if (entityIds.length === 0) return new Map()
  const id = await fieldId(attribute)
  const rows = await db()
    .select({
      entityId: schema.FieldValue.entityId,
      valueNumber: schema.FieldValue.valueNumber,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, f.organizationId),
        eq(schema.FieldValue.fieldId, id),
        inArray(schema.FieldValue.entityId, entityIds)
      )
    )
  const out = new Map<string, number>()
  for (const row of rows) {
    if (row.valueNumber != null) out.set(row.entityId, Number(row.valueNumber))
  }
  return out
}

beforeEach(async () => {
  h.failPosting = false
  h.freshReadOutcomes = []
  f = await seedBuildOrg()
})

describe('completeBuild commits its whole ledger', () => {
  it('writes one consume movement per component and one produce movement, priced from the standard', async () => {
    const buildId = await anInProgressBuild()

    const done = await completeBuild(db(), f.organizationId, f.userId, {
      buildId,
      quantityProduced: QUANTITY_PRODUCED,
    })
    if (done.isErr()) throw done.error

    const stored = await movementRows()
    expect(stored.map((row) => row.id).sort()).toEqual([...done.value.movementIds].sort())
    expect(stored).toHaveLength(f.componentPartIds.length + 1)
    expect(stored.every((row) => row.buildId === buildId)).toBe(true)

    // One row per consumed part, at the NEGATED BOM quantity and the frozen cost.
    for (const partId of f.componentPartIds) {
      const row = stored.find((movement) => movement.partId === partId)
      expect(row, `no consume movement for ${partId}`).toBeTruthy()
      const consumed = (f.qtyPerUnit.get(partId) as number) * QUANTITY_PRODUCED
      const unitCost = f.standardCosts.get(partId) as number
      expect(row?.type).toBe('build_consume')
      expect(row?.quantity).toBe(-consumed)
      expect(row?.unitCostMinor).toBe(unitCost)
      expect(row?.extendedCostMinor).toBe(-(unitCost * consumed))
      expect(row?.qtyPerUnit).toBe(f.qtyPerUnit.get(partId))
    }

    // ...and exactly one produce row, at the POSITIVE produced quantity.
    const produces = stored.filter((row) => row.type === 'build_produce')
    expect(produces).toHaveLength(1)
    expect(produces[0]?.partId).toBe(f.producedPartId)
    expect(produces[0]?.quantity).toBe(QUANTITY_PRODUCED)
    expect(produces[0]?.unitCostMinor).toBe(f.standardCosts.get(f.producedPartId))
  })

  it('stamps the build itself completed, with the costs the same commit wrote', async () => {
    const buildId = await anInProgressBuild()

    const done = await completeBuild(db(), f.organizationId, f.userId, {
      buildId,
      quantityProduced: QUANTITY_PRODUCED,
    })
    if (done.isErr()) throw done.error

    const reread = await getBuild(db(), f.organizationId, buildId)
    if (reread.isErr()) throw reread.error
    const build = reread.value
    expect(build?.status).toBe('completed')
    expect(build?.quantityProduced).toBe(QUANTITY_PRODUCED)
    expect(build?.materialCost).toBe(done.value.materialCost)
    expect(build?.producedValue).toBe(done.value.producedValue)
    expect(build?.varianceAmount).toBe(done.value.varianceAmount)
  })

  // 🛑 The wrinkle `complete-build.ts` reasons about but no unit test can see:
  // the mock above probes each instance it just created through the
  // MODULE-LEVEL pool, which is a different connection from `tx`. If the
  // movement writes were (wrongly) on the pool, that probe would find them.
  it('cannot see its own uncommitted rows from the module-level pool — which is how we know they are on tx', async () => {
    const buildId = await anInProgressBuild()
    h.freshReadOutcomes = []

    const done = await completeBuild(db(), f.organizationId, f.userId, {
      buildId,
      quantityProduced: QUANTITY_PRODUCED,
    })
    if (done.isErr()) throw done.error

    const movementReads = h.freshReadOutcomes.filter((read) =>
      done.value.movementIds.includes(read.id)
    )
    expect(movementReads).toHaveLength(done.value.movementIds.length)
    // NOT `.every(...) === false`, which one miss would satisfy: every single
    // re-read must have missed, because every single write was on `tx`.
    expect(movementReads.filter((read) => read.found)).toEqual([])

    // ...and harmless: the ids the caller got back are the real committed rows.
    const stored = await movementInstanceIds()
    expect(stored.sort()).toEqual([...done.value.movementIds].sort())
  })
})

describe('completeBuild sends only its covering frames', () => {
  it('build:changed for the build, records:changed and the QoH frame for the parts', async () => {
    const buildId = await anInProgressBuild()
    h.frames = []

    const done = await completeBuild(db(), f.organizationId, f.userId, {
      buildId,
      quantityProduced: QUANTITY_PRODUCED,
    })
    if (done.isErr()) throw done.error
    await vi.waitFor(() =>
      expect(h.frames.filter((frame) => frame.event === 'records:changed')).toHaveLength(1)
    )
    await new Promise((resolve) => setTimeout(resolve, 50))

    const buildFrames = h.frames.filter((frame) => frame.event === 'build:changed')
    expect(buildFrames.map((frame) => frame.data)).toEqual([
      { buildIds: [buildId], partIds: [f.producedPartId], orderIds: [], batchRuns: [] },
    ])

    const defOf = (roomKey: string) => roomKey.split('-records-')[1]
    const recordFrames = h.frames.filter((frame) => frame.roomKey.includes('-records-'))
    expect(recordFrames.map((frame) => `${frame.event} ${defOf(frame.roomKey)}`).sort()).toEqual(
      [`fieldValues:updated ${f.partDefId}`, `records:changed ${f.partDefId}`].sort()
    )
    const changed = (
      recordFrames.find((frame) => frame.event === 'records:changed')?.data as {
        entries: Array<{ recordId: string; fieldIds?: string[] }>
      }
    ).entries
    expect(changed.map((entry) => entry.recordId).sort()).toEqual(
      [f.producedPartId, ...f.componentPartIds].sort()
    )
    expect(changed.every((entry) => entry.fieldIds === undefined)).toBe(true)
  })
})

describe('a failure partway through rolls the whole completion back', () => {
  it('leaves no movement rows behind', async () => {
    const buildId = await anInProgressBuild()
    expect(await movementInstanceIds()).toHaveLength(0)
    h.freshReadOutcomes = []

    h.failPosting = true
    const done = await completeBuild(db(), f.organizationId, f.userId, {
      buildId,
      quantityProduced: QUANTITY_PRODUCED,
    })

    expect(done.isErr()).toBe(true)

    // 🛑 The premise, made explicit rather than assumed: an instance insert ran
    // once per component before the failure fired, so there really were rows
    // in flight for the rollback to undo. Without this the assertion below would
    // pass just as happily against a `completeBuild` that failed before writing
    // anything at all, and would be proving nothing.
    expect(h.freshReadOutcomes.length).toBeGreaterThanOrEqual(f.componentPartIds.length)

    // If any of those writes were on the pool rather than on `tx`, they would
    // still be here.
    expect(await movementInstanceIds()).toHaveLength(0)
  })

  // A build left reading `completed` with no ledger behind it is the corruption B8 guards against.
  it('does not leave the build reading completed', async () => {
    const buildId = await anInProgressBuild()

    h.failPosting = true
    const done = await completeBuild(db(), f.organizationId, f.userId, {
      buildId,
      quantityProduced: QUANTITY_PRODUCED,
    })
    expect(done.isErr()).toBe(true)

    const reread = await getBuild(db(), f.organizationId, buildId)
    if (reread.isErr()) throw reread.error
    expect(reread.value?.status).toBe('in_progress')
    expect(reread.value?.quantityProduced).toBeFalsy()
    expect(reread.value?.materialCost).toBeFalsy()
  })

  it('leaves the build completable on a second, unfailed attempt', async () => {
    const buildId = await anInProgressBuild()

    h.failPosting = true
    expect(
      (
        await completeBuild(db(), f.organizationId, f.userId, {
          buildId,
          quantityProduced: QUANTITY_PRODUCED,
        })
      ).isErr()
    ).toBe(true)

    h.failPosting = false
    const retry = await completeBuild(db(), f.organizationId, f.userId, {
      buildId,
      quantityProduced: QUANTITY_PRODUCED,
    })
    if (retry.isErr()) throw retry.error

    // Exactly one ledger, not two. B8's "one completion per build" would be
    // meaningless if a rolled-back attempt still counted as one.
    expect(await movementInstanceIds()).toHaveLength(f.componentPartIds.length + 1)
  })
})

describe('the post-commit settle sees the committed rows', () => {
  it('sets quantity on hand for the produced part and every consumed part', async () => {
    const buildId = await anInProgressBuild()

    const done = await completeBuild(db(), f.organizationId, f.userId, {
      buildId,
      quantityProduced: QUANTITY_PRODUCED,
    })
    if (done.isErr()) throw done.error

    const partIds = [f.producedPartId, ...f.componentPartIds]
    const qoh = await numbersByEntity('part_quantity_on_hand', partIds)

    // The settle runs AFTER the transaction returns, on the module-level pool: a non-zero number
    // here is only possible if the rows were committed and visible to that connection by then.
    expect(qoh.get(f.producedPartId)).toBe(QUANTITY_PRODUCED)
    for (const partId of f.componentPartIds) {
      const consumed = (f.qtyPerUnit.get(partId) as number) * QUANTITY_PRODUCED
      expect(qoh.get(partId)).toBe(-consumed)
    }
  })

  it('recalculates nothing when the completion rolled back', async () => {
    const buildId = await anInProgressBuild()

    h.failPosting = true
    const done = await completeBuild(db(), f.organizationId, f.userId, {
      buildId,
      quantityProduced: QUANTITY_PRODUCED,
    })
    expect(done.isErr()).toBe(true)

    const partIds = [f.producedPartId, ...f.componentPartIds]
    const qoh = await numbersByEntity('part_quantity_on_hand', partIds)
    for (const partId of partIds) {
      // Either untouched, or recomputed to the honest zero — never a number
      // sourced from rows that no longer exist.
      expect(qoh.get(partId) ?? 0).toBe(0)
    }
  })
})
