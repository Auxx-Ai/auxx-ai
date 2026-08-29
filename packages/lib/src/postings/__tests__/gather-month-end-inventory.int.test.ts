// packages/lib/src/postings/__tests__/gather-month-end-inventory.int.test.ts
//
// DB-backed tests (vitest.integration.config.ts -> auxx_test) for the claims the
// unit test structurally cannot make.
//
// `gather-month-end-inventory.test.ts` fakes the database, so it can prove the
// SHAPE of every query and the arithmetic that consumes the rows — and nothing
// about whether those queries actually select the rows they are supposed to.
// Four of this reader's rules live entirely in SQL:
//
//   1. **The window.** Movements before the cutoff are excluded and movements
//      after it are included, with the boundary interpreted in the BOOK
//      timezone — so a movement one hour either side of a month edge under a
//      non-UTC zone lands in the right month. This is the one test that proves
//      rule B end to end.
//   2. **Rule A.** A post-cutoff movement with a NULL cost fails the close and
//      names itself, rather than being silently dropped by a join.
//   3. **A build reversal nets out WITHOUT being filtered.** `reverseBuild`
//      writes a NEGATED `build_labor_cost` on a second row, so the cumulative
//      sum cancels it on its own; a filter would leave the original's absorption
//      in the total and remove the correction.
//   4. **An `adjust` movement appears in BOTH the balance and the adjustment
//      total.** It is a separate total, never a subtraction.
//
// 🛑 `packages/lib/vitest.config.ts` EXCLUDES `*.int.test.*`, so a green package
// suite is not evidence any of this ran. `pnpm -F @auxx/lib test:integration`.
//
// Rows are inserted directly as `EntityInstance` + `FieldValue` rather than
// through `receiveStock` / `completeBuild`, deliberately: half of what is under
// test here is what happens to rows the sanctioned writers REFUSE to write (a
// NULL cost) or cannot be made to write on demand (an exact `occurred_at` on a
// month boundary in a named zone). The fixture is the input; the reader is the
// thing under test.

import { type Database, schema } from '@auxx/database'
import { getTestDb } from '@auxx/test-utils'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type BuildFixture, seedBuildOrg } from '../../builds/__tests__/support/build-fixture'
import { getOrgCache } from '../../cache'
import { buildPostingDraft, type MonthEndInventorySnapshot } from '../draft'
import { gatherMonthEndInventoryInputs } from '../gather-month-end-inventory'
import { OPENING_BASELINE_SETTING_KEYS } from '../opening-baseline'

const db = () => getTestDb() as unknown as Database

// The two queue-backed externals, mocked off. `seedBuildOrg` writes parts and
// subparts through `UnifiedCrudHandler`, whose interactive lane AWAITS
// `publisher.publishLater` — a BullMQ write that never settles against an
// unreachable Redis. Same reason, same shape, as
// `builds/__tests__/complete-build-transaction.int.test.ts`.
vi.mock('../../events/publisher', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, publisher: { publish: async () => {}, publishLater: async () => {} } }
})

vi.mock('../../dedup/enqueue-scan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../dedup/enqueue-scan')>()
  return { ...actual, enqueueDuplicateScan: async () => {} }
})

const K = OPENING_BASELINE_SETTING_KEYS

/** Cutoff December 2026, books kept in New York — UTC-5 in winter, UTC-4 in summer. */
const CUTOFF = '2026-12'
const ZONE = 'America/New_York'

const OPENING = {
  inventory_raw_materials: 125_000,
  inventory_wip: 0,
  inventory_finished_goods: 480_050,
}

let f: BuildFixture

// ── Fixture helpers ──────────────────────────────────────────────────────────

/** `systemAttribute` -> `CustomField.id`, straight off the org cache. */
async function fieldId(attribute: string): Promise<string> {
  const fields = await getOrgCache()
    .from(f.organizationId, 'customFields')
    .bySystemAttributes([attribute] as never)
  const field = (fields as Record<string, { id: string } | null>)[attribute]
  if (!field) throw new Error(`no CustomField for ${attribute}`)
  return field.id
}

/** Finalize the accounting setup for the seeded org, and drop the settings cache. */
async function finalizeAccountingSetup(overrides: Record<string, unknown> = {}): Promise<void> {
  const values: Record<string, unknown> = {
    [K.setupState]: 'finalized',
    [K.cutoffPeriod]: CUTOFF,
    [K.bookTimeZone]: ZONE,
    [K.inventory_raw_materials]: OPENING.inventory_raw_materials,
    [K.inventory_wip]: OPENING.inventory_wip,
    [K.inventory_finished_goods]: OPENING.inventory_finished_goods,
    ...overrides,
  }

  const now = new Date()
  for (const [key, value] of Object.entries(values)) {
    await db()
      .insert(schema.OrganizationSetting)
      .values({ organizationId: f.organizationId, key, value, scope: 'GENERAL', updatedAt: now })
  }

  // 🛑 `readOpeningBaseline` reads through `getOrgCache().get(org, 'orgSettings')`
  // — the same cached path every other consumer uses — so a direct table insert
  // is invisible to it until the key is dropped. In production the settings
  // router fires `org.settings.changed`; here the write is the test's own.
  await getOrgCache().invalidateAndRecompute(f.organizationId, ['orgSettings'])
}

interface MovementSpec {
  /** `stock_movement_occurred_at`. Omit to write a movement with no accounting date. */
  occurredAt?: Date
  type?: string
  unitCost?: number | null
  extendedCost?: number | null
  glAccount?: string | null
  /** `EntityInstance.createdAt`. Defaults to `occurredAt`, else long before the cutoff. */
  createdAt?: Date
  adjustSubparts?: boolean
}

/** Write one `stock_movement` row directly. Returns its instance id. */
async function insertMovement(spec: MovementSpec): Promise<string> {
  const createdAt = spec.createdAt ?? spec.occurredAt ?? new Date('2020-01-01T00:00:00.000Z')

  const [instance] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: f.organizationId,
      entityDefinitionId: f.movementDefId,
      displayName: 'movement',
      createdAt,
      updatedAt: createdAt,
    })
    .returning({ id: schema.EntityInstance.id })

  const entityId = (instance as { id: string }).id

  const write = async (attribute: string, value: Record<string, unknown>) => {
    await db()
      .insert(schema.FieldValue)
      .values({
        organizationId: f.organizationId,
        entityId,
        entityDefinitionId: f.movementDefId,
        fieldId: await fieldId(attribute),
        updatedAt: createdAt,
        ...value,
      })
  }

  await write('stock_movement_part', { relatedEntityId: f.componentPartIds[0] as string })
  await write('stock_movement_type', { optionId: spec.type ?? 'receive' })
  await write('stock_movement_quantity', { valueNumber: 1 })
  if (spec.occurredAt) {
    await write('stock_movement_occurred_at', { valueDate: spec.occurredAt.toISOString() })
  }
  if (spec.unitCost !== null) {
    await write('stock_movement_unit_cost', { valueNumber: spec.unitCost ?? 100 })
  }
  if (spec.extendedCost !== null) {
    await write('stock_movement_extended_cost', { valueNumber: spec.extendedCost ?? 100 })
  }
  if (spec.glAccount !== null) {
    await write('stock_movement_gl_account', {
      valueText: spec.glAccount ?? 'inventory_raw_materials',
    })
  }
  if (spec.adjustSubparts !== undefined) {
    await write('stock_movement_adjust_subparts', { valueBoolean: spec.adjustSubparts })
  }

  return entityId
}

/** Write one completed `build` row directly. Returns its instance id. */
async function insertBuild(spec: {
  completedAt: Date
  laborCost: number
  overheadCost: number
}): Promise<string> {
  const [instance] = await db()
    .insert(schema.EntityInstance)
    .values({
      organizationId: f.organizationId,
      entityDefinitionId: f.buildDefId,
      displayName: 'build',
      createdAt: spec.completedAt,
      updatedAt: spec.completedAt,
    })
    .returning({ id: schema.EntityInstance.id })

  const entityId = (instance as { id: string }).id

  const write = async (attribute: string, value: Record<string, unknown>) => {
    await db()
      .insert(schema.FieldValue)
      .values({
        organizationId: f.organizationId,
        entityId,
        entityDefinitionId: f.buildDefId,
        fieldId: await fieldId(attribute),
        updatedAt: spec.completedAt,
        ...value,
      })
  }

  await write('build_status', { optionId: 'completed' })
  await write('build_completed_at', { valueDate: spec.completedAt.toISOString() })
  await write('build_labor_cost', { valueNumber: spec.laborCost })
  await write('build_overhead_cost', { valueNumber: spec.overheadCost })

  return entityId
}

async function gather(periodKey: string) {
  return gatherMonthEndInventoryInputs(db(), f.organizationId, periodKey)
}

beforeEach(async () => {
  f = await seedBuildOrg({ components: 1 })
  await finalizeAccountingSetup()
})

// ── The window ───────────────────────────────────────────────────────────────

describe('the cumulative window starts at the cutoff', () => {
  it('excludes movements before the cutoff and includes movements after it', async () => {
    // Pre-cutoff history. The frozen opening snapshot replaces it entirely, so
    // summing it would double-count everything the wizard already counted.
    await insertMovement({
      occurredAt: new Date('2026-11-15T12:00:00.000Z'),
      extendedCost: 999_999,
    })
    await insertMovement({
      occurredAt: new Date('2026-12-31T12:00:00.000Z'),
      extendedCost: 888_888,
    })
    // After the cutoff.
    await insertMovement({ occurredAt: new Date('2027-01-15T12:00:00.000Z'), extendedCost: 25_000 })

    const inputs = (await gather('2027-01'))._unsafeUnwrap()

    expect(inputs.current.balances.inventory_raw_materials).toBe(
      OPENING.inventory_raw_materials + 25_000
    )
  })

  it('is CUMULATIVE — a later month still carries every movement since the cutoff', async () => {
    await insertMovement({ occurredAt: new Date('2027-01-15T12:00:00.000Z'), extendedCost: 25_000 })
    await insertMovement({ occurredAt: new Date('2027-02-15T12:00:00.000Z'), extendedCost: 10_000 })
    await insertMovement({ occurredAt: new Date('2027-03-15T12:00:00.000Z'), extendedCost: 1_000 })

    const february = (await gather('2027-02'))._unsafeUnwrap()
    // Not "movements in February" — everything from the cutoff through the end
    // of February. That is what lets a backdated row appear in the next open
    // entry carrying its own classification.
    expect(february.current.balances.inventory_raw_materials).toBe(
      OPENING.inventory_raw_materials + 35_000
    )
  })

  it('excludes an archived movement', async () => {
    const movementId = await insertMovement({
      occurredAt: new Date('2027-01-15T12:00:00.000Z'),
      extendedCost: 25_000,
    })
    await db()
      .update(schema.EntityInstance)
      .set({ archivedAt: new Date() })
      .where(eq(schema.EntityInstance.id, movementId))

    const inputs = (await gather('2027-01'))._unsafeUnwrap()
    expect(inputs.current.balances.inventory_raw_materials).toBe(OPENING.inventory_raw_materials)
  })
})

describe('🛑 rule B — a boundary movement lands in the right month, in the BOOK timezone', () => {
  // 7pm on January 31 in New York is 00:00 on February 1 in UTC. A reader that
  // derived the boundary in UTC posts this receipt into February — invisible
  // except at a close, and uncorrectable once January is locked.
  const LATE_ON_JANUARY_31 = new Date('2027-02-01T00:00:00.000Z')

  beforeEach(async () => {
    await insertMovement({ occurredAt: LATE_ON_JANUARY_31, extendedCost: 25_000 })
  })

  it('counts it in January, because January in New York has not ended', async () => {
    const january = (await gather('2027-01'))._unsafeUnwrap()
    expect(january.current.balances.inventory_raw_materials).toBe(
      OPENING.inventory_raw_materials + 25_000
    )
    expect(january.txnDate).toBe('2027-01-31')
  })

  it('does not double it in February — the window is cumulative, so it appears once', async () => {
    const february = (await gather('2027-02'))._unsafeUnwrap()
    expect(february.current.balances.inventory_raw_materials).toBe(
      OPENING.inventory_raw_materials + 25_000
    )
  })

  it('the SAME instant is February when the books are kept in UTC', async () => {
    // The proof that the zone is doing the work rather than the calendar: one
    // row, one instant, two answers, and the only thing that changed is a
    // setting.
    await db()
      .update(schema.OrganizationSetting)
      .set({ value: 'UTC' })
      .where(
        and(
          eq(schema.OrganizationSetting.organizationId, f.organizationId),
          eq(schema.OrganizationSetting.key, K.bookTimeZone)
        )
      )
    await getOrgCache().invalidateAndRecompute(f.organizationId, ['orgSettings'])

    const january = (await gather('2027-01'))._unsafeUnwrap()
    expect(january.current.balances.inventory_raw_materials).toBe(OPENING.inventory_raw_materials)

    const february = (await gather('2027-02'))._unsafeUnwrap()
    expect(february.current.balances.inventory_raw_materials).toBe(
      OPENING.inventory_raw_materials + 25_000
    )
  })
})

// ── Rule A ───────────────────────────────────────────────────────────────────

describe('🛑 rule A — a post-cutoff uncosted movement fails the close', () => {
  it('refuses and names the movement when the extended cost is NULL', async () => {
    const offender = await insertMovement({
      occurredAt: new Date('2027-01-15T12:00:00.000Z'),
      extendedCost: null,
    })

    const result = await gather('2027-01')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain(offender)
  })

  it('refuses when the unit cost is NULL', async () => {
    const offender = await insertMovement({
      occurredAt: new Date('2027-01-15T12:00:00.000Z'),
      unitCost: null,
    })

    expect((await gather('2027-01'))._unsafeUnwrapErr().message).toContain(offender)
  })

  it('refuses when the movement carries no inventory role', async () => {
    const offender = await insertMovement({
      occurredAt: new Date('2027-01-15T12:00:00.000Z'),
      glAccount: null,
    })

    expect((await gather('2027-01'))._unsafeUnwrapErr().message).toContain(offender)
  })

  it('refuses a role the chart cannot value', async () => {
    const offender = await insertMovement({
      occurredAt: new Date('2027-01-15T12:00:00.000Z'),
      glAccount: 'inventory_consigned',
    })

    expect((await gather('2027-01'))._unsafeUnwrapErr().message).toContain(offender)
  })

  it('refuses a movement with no accounting date at all that was learned of after the cutoff', async () => {
    // It cannot be placed in any period, so the window predicate cannot see it.
    // A reader that stopped there would drop it in silence and produce a
    // balanced entry that understates inventory.
    const offender = await insertMovement({
      createdAt: new Date('2027-01-15T12:00:00.000Z'),
      extendedCost: 25_000,
    })

    expect((await gather('2027-01'))._unsafeUnwrapErr().message).toContain(offender)
  })

  it('still IGNORES an uncosted movement from before the cutoff', async () => {
    // The mirror of rule A, and the reason the window starts where it does.
    // Historical movements predate the costing regime; the opening snapshot
    // replaces that history entirely.
    await insertMovement({ occurredAt: new Date('2026-06-15T12:00:00.000Z'), extendedCost: null })
    await insertMovement({ createdAt: new Date('2026-06-15T12:00:00.000Z') })

    const inputs = (await gather('2027-01'))._unsafeUnwrap()
    expect(inputs.current.balances.inventory_raw_materials).toBe(OPENING.inventory_raw_materials)
  })

  it('ignores the uncosted PARENT of a bill-of-materials explosion', async () => {
    // Its children carry the real quantities, which is why
    // `recalculateQoHForPart` excludes it from the quantity ledger too.
    await insertMovement({
      occurredAt: new Date('2027-01-15T12:00:00.000Z'),
      adjustSubparts: true,
      extendedCost: null,
      unitCost: null,
      glAccount: null,
    })

    const result = await gather('2027-01')
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().current.balances.inventory_raw_materials).toBe(
      OPENING.inventory_raw_materials
    )
  })
})

// ── The adjustment lane ──────────────────────────────────────────────────────

describe('an `adjust` movement appears in BOTH the balance and the adjustment total', () => {
  it('moves the balance and is separately classified, without being subtracted out', async () => {
    await insertMovement({ occurredAt: new Date('2027-01-10T12:00:00.000Z'), extendedCost: 30_000 })
    await insertMovement({
      occurredAt: new Date('2027-01-20T12:00:00.000Z'),
      type: 'adjust',
      extendedCost: -4_000,
    })

    const { current } = (await gather('2027-01'))._unsafeUnwrap()

    // 🛑 The receipt AND the shrinkage are both in the balance. `G12` breaks the
    // shrinkage out into its own leg; it does not remove it from inventory
    // twice.
    expect(current.balances.inventory_raw_materials).toBe(
      OPENING.inventory_raw_materials + 30_000 - 4_000
    )
    expect(current.activityTotals.inventoryAdjustments).toBe(-4_000)
  })

  it('sums adjustments across roles and keeps the sign', async () => {
    await insertMovement({
      occurredAt: new Date('2027-01-10T12:00:00.000Z'),
      type: 'adjust',
      extendedCost: -4_000,
    })
    await insertMovement({
      occurredAt: new Date('2027-01-11T12:00:00.000Z'),
      type: 'adjust',
      glAccount: 'inventory_finished_goods',
      extendedCost: 1_500,
    })

    const { current } = (await gather('2027-01'))._unsafeUnwrap()
    expect(current.activityTotals.inventoryAdjustments).toBe(-2_500)
    expect(current.balances.inventory_raw_materials).toBe(OPENING.inventory_raw_materials - 4_000)
    expect(current.balances.inventory_finished_goods).toBe(OPENING.inventory_finished_goods + 1_500)
  })
})

// ── Absorption ───────────────────────────────────────────────────────────────

describe('absorption reads the frozen build costs', () => {
  it('sums labour and overhead over builds completed since the cutoff', async () => {
    await insertBuild({
      completedAt: new Date('2027-01-10T12:00:00.000Z'),
      laborCost: 7_500,
      overheadCost: 2_250,
    })
    await insertBuild({
      completedAt: new Date('2027-02-10T12:00:00.000Z'),
      laborCost: 500,
      overheadCost: 100,
    })
    // Before the cutoff — covered by the opening snapshot.
    await insertBuild({
      completedAt: new Date('2026-11-10T12:00:00.000Z'),
      laborCost: 99_999,
      overheadCost: 99_999,
    })

    const { activityTotals } = (await gather('2027-02'))._unsafeUnwrap().current
    expect(activityTotals.absorbedLabor).toBe(8_000)
    expect(activityTotals.absorbedOverhead).toBe(2_350)
  })

  it('🛑 nets a reversal out WITHOUT filtering it', async () => {
    // `reverse-build.ts` writes a NEGATED `build_labor_cost` onto a second build
    // row. The cumulative sum cancels the pair on its own. Filtering reversals
    // would leave the original's absorption in the total and remove the
    // correction that cancels it — double-counting the mistake.
    await insertBuild({
      completedAt: new Date('2027-01-10T12:00:00.000Z'),
      laborCost: 7_500,
      overheadCost: 2_250,
    })
    await insertBuild({
      completedAt: new Date('2027-01-20T12:00:00.000Z'),
      laborCost: -7_500,
      overheadCost: -2_250,
    })

    const { activityTotals } = (await gather('2027-01'))._unsafeUnwrap().current
    expect(activityTotals.absorbedLabor).toBe(0)
    expect(activityTotals.absorbedOverhead).toBe(0)
  })

  it('ignores a build with no completion date', async () => {
    const [instance] = await db()
      .insert(schema.EntityInstance)
      .values({
        organizationId: f.organizationId,
        entityDefinitionId: f.buildDefId,
        displayName: 'planned build',
        updatedAt: new Date(),
      })
      .returning({ id: schema.EntityInstance.id })
    await db()
      .insert(schema.FieldValue)
      .values({
        organizationId: f.organizationId,
        entityId: (instance as { id: string }).id,
        entityDefinitionId: f.buildDefId,
        fieldId: await fieldId('build_labor_cost'),
        valueNumber: 99_999,
        updatedAt: new Date(),
      })

    const { activityTotals } = (await gather('2027-01'))._unsafeUnwrap().current
    expect(activityTotals.absorbedLabor).toBe(0)
  })
})

// ── The cutover, against real rows ───────────────────────────────────────────

describe('the cutover close', () => {
  it('measures the first month against the frozen opening baseline', async () => {
    await insertMovement({ occurredAt: new Date('2027-01-15T12:00:00.000Z'), extendedCost: 25_000 })

    const inputs = (await gather('2027-01'))._unsafeUnwrap()

    expect(inputs.periodKey).toBe('2027-01')
    expect(inputs.txnDate).toBe('2027-01-31')
    expect(inputs.prior).toEqual({
      balances: { ...OPENING },
      activityTotals: { absorbedLabor: 0, absorbedOverhead: 0, inventoryAdjustments: 0 },
    })
  })

  it('refuses a period at or before the cutoff', async () => {
    expect((await gather(CUTOFF)).isErr()).toBe(true)
    expect((await gather('2026-06')).isErr()).toBe(true)
  })
})

// ── The prior-row selection rule, against real rows ──────────────────────────
//
// 🛑 A WRONG prior still produces a perfectly balanced entry. That is why
// `assertions.before` exists at all, and it is why this rule has to be asserted
// directly: nothing downstream of the reader can detect a broken selection.

interface PostingSpec {
  periodKey: string
  revision?: number
  status?: 'pending' | 'posted' | 'failed' | 'reversed'
  docNumber: string
  /** The `assertions.after` this posting claims. Omit for the corrupt-chain case. */
  after?: MonthEndInventorySnapshot | null
  reversesId?: string
}

async function insertPosting(spec: PostingSpec): Promise<string> {
  const snapshot = spec.after ?? {
    balances: { inventory_raw_materials: 0, inventory_wip: 0, inventory_finished_goods: 0 },
    activityTotals: { absorbedLabor: 0, absorbedOverhead: 0, inventoryAdjustments: 0 },
  }
  const draft = buildPostingDraft({
    docNumber: spec.docNumber,
    revision: spec.revision ?? 0,
    entry: {} as never,
    resolvedLines: [],
    assertions:
      spec.after === null
        ? undefined
        : { kind: 'month_end_inventory', before: snapshot, after: snapshot },
  })

  const [row] = await db()
    .insert(schema.GlPosting)
    .values({
      organizationId: f.organizationId,
      postingType: 'month_end_inventory',
      periodKey: spec.periodKey,
      revision: spec.revision ?? 0,
      status: spec.status ?? 'posted',
      txnDate: `${spec.periodKey}-28`,
      docNumber: spec.docNumber,
      totalMinor: 1_000,
      draft,
      requestId: `req-${spec.docNumber}`,
      postedAt: new Date(),
      reversesId: spec.reversesId,
      updatedAt: new Date(),
    })
    .returning({ id: schema.GlPosting.id })

  return (row as { id: string }).id
}

/** A snapshot whose raw-materials balance identifies which posting was chosen. */
function marker(raw: number): MonthEndInventorySnapshot {
  return {
    balances: { inventory_raw_materials: raw, inventory_wip: 0, inventory_finished_goods: 0 },
    activityTotals: { absorbedLabor: 0, absorbedOverhead: 0, inventoryAdjustments: 0 },
  }
}

describe('the prior effective posting, selected from real rows', () => {
  it('takes the GREATEST period strictly before this one', async () => {
    await insertPosting({ periodKey: '2027-01', docNumber: 'JE-1', after: marker(111) })
    await insertPosting({ periodKey: '2027-02', docNumber: 'JE-2', after: marker(222) })
    // Not eligible: this IS the period being closed.
    await insertPosting({ periodKey: '2027-03', docNumber: 'JE-3', after: marker(333) })

    const inputs = (await gather('2027-03'))._unsafeUnwrap()
    expect(inputs.prior.balances.inventory_raw_materials).toBe(222)
  })

  it('takes the GREATEST revision within that period', async () => {
    const original = await insertPosting({
      periodKey: '2027-02',
      docNumber: 'JE-2',
      status: 'reversed',
      after: marker(222),
    })
    // The reversal is an ordinary `posted` entry (decision G4) and carries the
    // assertions resulting after ITSELF.
    await insertPosting({
      periodKey: '2027-02',
      revision: 1,
      docNumber: 'JE-2-R1',
      after: marker(999),
      reversesId: original,
    })

    const inputs = (await gather('2027-03'))._unsafeUnwrap()
    expect(inputs.prior.balances.inventory_raw_materials).toBe(999)
  })

  it('ignores a `pending` or `failed` row', async () => {
    await insertPosting({ periodKey: '2027-01', docNumber: 'JE-1', after: marker(111) })
    await insertPosting({
      periodKey: '2027-02',
      docNumber: 'JE-2',
      status: 'failed',
      after: marker(222),
    })

    const inputs = (await gather('2027-03'))._unsafeUnwrap()
    expect(inputs.prior.balances.inventory_raw_materials).toBe(111)
  })

  it('ignores another organization’s postings', async () => {
    const other = await seedBuildOrg({ components: 1 })
    await db()
      .insert(schema.GlPosting)
      .values({
        organizationId: other.organizationId,
        postingType: 'month_end_inventory',
        periodKey: '2027-02',
        revision: 0,
        status: 'posted',
        txnDate: '2027-02-28',
        docNumber: 'JE-OTHER',
        totalMinor: 1_000,
        draft: buildPostingDraft({
          docNumber: 'JE-OTHER',
          revision: 0,
          entry: {} as never,
          resolvedLines: [],
          assertions: { kind: 'month_end_inventory', before: marker(1), after: marker(777) },
        }),
        requestId: 'req-other',
        postedAt: new Date(),
        updatedAt: new Date(),
      })

    const inputs = (await gather('2027-03'))._unsafeUnwrap()
    expect(inputs.prior.balances).toEqual({ ...OPENING })
  })

  it('🛑 refuses a prior row whose draft carries no assertions, naming the document', async () => {
    await insertPosting({ periodKey: '2027-02', docNumber: 'JE-BROKEN', after: null })

    const result = await gather('2027-03')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('JE-BROKEN')
  })
})
