// packages/lib/src/builds/__tests__/complete-build-transaction.int.test.ts
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
//   2. **Rollback.** A failure raised between the consume writes and the produce
//      write leaves NOTHING behind — no movement instances, no movement field
//      values, and a build still reading `in_progress`.
//   3. **The post-commit recalculation sees committed rows.** `batchRecalculateQoH`
//      runs on the module-level pool after the transaction returns (trap 1), so
//      the quantity on hand it writes is the proof the rows were visible to a
//      different connection by then.
//
// It also pins the known wrinkle rather than trusting the reasoning about it:
// `createEntity`'s post-write `getEntityInstance` re-read uses the module-level
// pool and therefore CANNOT see the row it just created inside `tx`. That is
// observed directly below (`freshReadOutcomes`) and shown to be harmless,
// because the re-read falls back to the in-transaction instance and the quiet
// lane suppresses its only other consumer, the realtime frame.

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { and, eq, inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrgCache } from '../../cache'
import { createBuild, startBuild } from '../build-mutations'
import { getBuild } from '../build-queries'
import { completeBuild } from '../complete-build'
import { type BuildFixture, seedBuildOrg } from './support/build-fixture'

const db = () => getTestDb() as unknown as Database

// ── The two queue-backed externals, mocked OFF ───────────────────────────────
//
// ⚠️ Not decoration — without these the suite hangs forever rather than failing.
// `publisher.publishLater` and `enqueueDuplicateScan` are BullMQ writes, and
// BullMQ's default `maxRetriesPerRequest: null` means a command issued against
// an unreachable Redis never settles. `publishLater` is AWAITED on the
// interactive write lane (`publishFieldTriggerEvents` ->
// `setValuesForEntity`), so a single `startBuild` blocks the process. Neither
// is part of any claim below: the field pre-hook chain, the transaction and
// `batchRecalculateQoH` all run for real.

vi.mock('../../events/publisher', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, publisher: { publish: async () => {}, publishLater: async () => {} } }
})

vi.mock('../../dedup/enqueue-scan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../dedup/enqueue-scan')>()
  return { ...actual, enqueueDuplicateScan: async () => {} }
})

// ── The two seams the tests steer, both partial mocks ────────────────────────

const h = vi.hoisted(() => ({
  /**
   * Armed only around the call under test. `resolveInventoryRoleForPartKind` is
   * called once per component line while the plan is PRICED (outside any write)
   * and then once more for the produce row — after every consume movement has
   * been written and before the build's own status/cost update. Throwing on the
   * `finished_good` call is therefore a failure exactly partway through the
   * transaction, which is the shape a real defect takes.
   */
  failOnFinishedGoodGlAccount: false,
  /** Every `getEntityInstance` re-read `createEntity` made, and whether it found the row. */
  freshReadOutcomes: [] as Array<{ id: string; found: boolean }>,
}))

vi.mock('../../receiving/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../receiving/client')>()
  return {
    ...actual,
    resolveInventoryRoleForPartKind: (
      kind: Parameters<typeof actual.resolveInventoryRoleForPartKind>[0]
    ) => {
      if (h.failOnFinishedGoodGlAccount && kind === 'finished_good') {
        throw new Error('injected failure between the consume rows and the produce row')
      }
      return actual.resolveInventoryRoleForPartKind(kind)
    },
  }
})

vi.mock('../../entity-instances', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../entity-instances')>()
  return {
    ...actual,
    // Right after each instance insert, probe for the row through the
    // MODULE-LEVEL pool (a different connection from `tx`). `createEntity`
    // used to do such a re-read itself; now the fresh row comes back on the
    // write's own connection, so the probe lives here.
    createEntityInstance: async (
      params: Parameters<typeof actual.createEntityInstance>[0],
      tx?: Parameters<typeof actual.createEntityInstance>[1]
    ) => {
      const result = await actual.createEntityInstance(params, tx)
      if (result.isOk()) {
        const probe = await actual.getEntityInstance({
          id: result.value.id,
          organizationId: params.organizationId,
        })
        h.freshReadOutcomes.push({ id: result.value.id, found: probe.isOk() })
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

/** Every `stock_movement` instance id in the org. */
async function movementInstanceIds(): Promise<string[]> {
  const rows = await db()
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, f.organizationId),
        eq(schema.EntityInstance.entityDefinitionId, f.movementDefId)
      )
    )
  return rows.map((row) => row.id)
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

/** The related-record target of `attribute` on each of `entityIds`. */
async function relatedByEntity(
  attribute: string,
  entityIds: string[]
): Promise<Map<string, string>> {
  const id = await fieldId(attribute)
  const rows = await db()
    .select({
      entityId: schema.FieldValue.entityId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, f.organizationId),
        eq(schema.FieldValue.fieldId, id),
        inArray(schema.FieldValue.entityId, entityIds)
      )
    )
  const out = new Map<string, string>()
  for (const row of rows) {
    if (row.relatedEntityId) out.set(row.entityId, row.relatedEntityId)
  }
  return out
}

/** The stored option id of `attribute` on each of `entityIds`. */
async function optionsByEntity(
  attribute: string,
  entityIds: string[]
): Promise<Map<string, string>> {
  const id = await fieldId(attribute)
  const rows = await db()
    .select({
      entityId: schema.FieldValue.entityId,
      optionId: schema.FieldValue.optionId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, f.organizationId),
        eq(schema.FieldValue.fieldId, id),
        inArray(schema.FieldValue.entityId, entityIds)
      )
    )
  const out = new Map<string, string>()
  for (const row of rows) {
    if (row.optionId) out.set(row.entityId, row.optionId)
  }
  return out
}

beforeEach(async () => {
  h.failOnFinishedGoodGlAccount = false
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

    const stored = await movementInstanceIds()
    expect(stored.sort()).toEqual([...done.value.movementIds].sort())
    expect(stored).toHaveLength(f.componentPartIds.length + 1)

    const quantities = await numbersByEntity('stock_movement_quantity', stored)
    const unitCosts = await numbersByEntity('stock_movement_unit_cost', stored)
    const extended = await numbersByEntity('stock_movement_extended_cost', stored)
    const parts = await relatedByEntity('stock_movement_part', stored)
    const types = await optionsByEntity('stock_movement_type', stored)

    // One row per consumed part, at the NEGATED BOM quantity and the frozen cost.
    for (const partId of f.componentPartIds) {
      const movementId = stored.find((id) => parts.get(id) === partId)
      expect(movementId, `no consume movement for ${partId}`).toBeTruthy()
      const consumed = (f.qtyPerUnit.get(partId) as number) * QUANTITY_PRODUCED
      const unitCost = f.standardCosts.get(partId) as number
      expect(types.get(movementId as string)).toBe('build_consume')
      expect(quantities.get(movementId as string)).toBe(-consumed)
      expect(unitCosts.get(movementId as string)).toBe(unitCost)
      expect(extended.get(movementId as string)).toBe(-(unitCost * consumed))
    }

    // ...and exactly one produce row, at the POSITIVE produced quantity.
    const produceIds = stored.filter((id) => types.get(id) === 'build_produce')
    expect(produceIds).toHaveLength(1)
    const produceId = produceIds[0] as string
    expect(parts.get(produceId)).toBe(f.producedPartId)
    expect(quantities.get(produceId)).toBe(QUANTITY_PRODUCED)
    expect(unitCosts.get(produceId)).toBe(f.standardCosts.get(f.producedPartId))
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

describe('a failure partway through rolls the whole completion back', () => {
  it('leaves no movement instances behind', async () => {
    const buildId = await anInProgressBuild()
    expect(await movementInstanceIds()).toHaveLength(0)
    h.freshReadOutcomes = []

    h.failOnFinishedGoodGlAccount = true
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

  it('leaves no movement field values behind', async () => {
    const buildId = await anInProgressBuild()

    h.failOnFinishedGoodGlAccount = true
    const done = await completeBuild(db(), f.organizationId, f.userId, {
      buildId,
      quantityProduced: QUANTITY_PRODUCED,
    })
    expect(done.isErr()).toBe(true)

    const orphans = await db()
      .select({ id: schema.FieldValue.id })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, f.organizationId),
          eq(schema.FieldValue.entityDefinitionId, f.movementDefId)
        )
      )
    expect(orphans).toEqual([])
  })

  // 🛑 The one that matters most. A build left reading `completed` with no
  // ledger behind it is exactly the state `build-status-guard.ts` exists to
  // prevent a human from creating by hand.
  it('does not leave the build reading completed', async () => {
    const buildId = await anInProgressBuild()

    h.failOnFinishedGoodGlAccount = true
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

    h.failOnFinishedGoodGlAccount = true
    expect(
      (
        await completeBuild(db(), f.organizationId, f.userId, {
          buildId,
          quantityProduced: QUANTITY_PRODUCED,
        })
      ).isErr()
    ).toBe(true)

    h.failOnFinishedGoodGlAccount = false
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

describe('the post-commit recalculation sees the committed rows', () => {
  it('sets quantity on hand for the produced part and every consumed part', async () => {
    const buildId = await anInProgressBuild()

    const done = await completeBuild(db(), f.organizationId, f.userId, {
      buildId,
      quantityProduced: QUANTITY_PRODUCED,
    })
    if (done.isErr()) throw done.error

    const partIds = [f.producedPartId, ...f.componentPartIds]
    const qoh = await numbersByEntity('part_quantity_on_hand', partIds)

    // 🛑 `batchRecalculateQoH` runs AFTER the transaction returns, on the
    // module-level pool. A non-zero number here is only possible if the movement
    // rows were committed and visible to that other connection by then — which
    // is trap 1 discharged, observed rather than reasoned about.
    expect(qoh.get(f.producedPartId)).toBe(QUANTITY_PRODUCED)
    for (const partId of f.componentPartIds) {
      const consumed = (f.qtyPerUnit.get(partId) as number) * QUANTITY_PRODUCED
      expect(qoh.get(partId)).toBe(-consumed)
    }
  })

  it('recalculates nothing when the completion rolled back', async () => {
    const buildId = await anInProgressBuild()

    h.failOnFinishedGoodGlAccount = true
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
