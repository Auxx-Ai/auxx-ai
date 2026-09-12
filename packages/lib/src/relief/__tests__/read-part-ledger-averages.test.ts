// packages/lib/src/relief/__tests__/read-part-ledger-averages.test.ts
//
// Pins what a canned-result mock cannot catch: that readPartLedgerAverages's
// SQL actually EXCLUDES a movement flagged adjust_subparts from BOTH the
// value and quantity sums, in the SAME statement, under the SAME predicate
// bom/qoh.ts's batchRecalculateQoH applies to its own grouped SUM (brief 50
// §3.4 - the numerator and denominator must describe the identical row set,
// or every part with an exploded movement in its history gets a wrong
// average).
//
// The fake `db.select` below does not trust a canned answer. It inspects the
// bound parameters of the actual join conditions the production query builds
// - the technique field-hooks/post/fulfillment-line-rollups-scope.test.ts
// established for this exact purpose - and executes the SUM against an
// in-memory ledger whose flagged row deliberately carries a huge,
// opposite-signed value. If the flag join were dropped or misfielded, this
// fixture would sum it in and the assertions below would fail loudly rather
// than passing on a coincidence.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = 'org_1'
const PART_A = 'part-a'
const PART_B = 'part-b'

const FIELD_IDS = {
  part: 'fld-part',
  quantity: 'fld-qty',
  extendedCost: 'fld-cost',
  adjustSubparts: 'fld-flag',
}

const FIELDS: Record<string, { id: string; type: string } | null> = {
  stock_movement_part: { id: FIELD_IDS.part, type: 'RELATIONSHIP' },
  stock_movement_quantity: { id: FIELD_IDS.quantity, type: 'NUMBER' },
  stock_movement_extended_cost: { id: FIELD_IDS.extendedCost, type: 'CURRENCY' },
  stock_movement_adjust_subparts: { id: FIELD_IDS.adjustSubparts, type: 'CHECKBOX' },
}

/** One committed `stock_movement` row in the fixture ledger. */
interface FixtureMovement {
  partId: string
  quantity: number
  extendedCost: number
  adjustSubparts?: boolean
}

const h = vi.hoisted(() => ({
  movements: [] as FixtureMovement[],
  fieldsMissing: false,
}))

/**
 * Bound string parameters of a Drizzle `sql` node - field ids, the IN-list
 * values and org id are all `Param`s, and this walks the chunk tree to find
 * them. Copied from `receiving/__tests__/receipt-query-count.test.ts` via
 * `fulfillment-line-rollups-scope.test.ts`, which established the technique
 * for this exact purpose: answering a mock query from what its join
 * predicates actually name, not from a canned queue.
 */
function boundStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) boundStrings(child, out)
    return out
  }
  const record = node as Record<string, unknown>
  if (Array.isArray(record.queryChunks)) return boundStrings(record.queryChunks, out)
  if (typeof record.value === 'string') out.push(record.value)
  return out
}

/**
 * Executes the grouped SUM against the fixture ledger using ONLY what the
 * captured join parameters actually name: which part ids the fv_part join
 * restricted to, and whether the fv_flag join carries the real
 * `adjust_subparts` field id. A dropped or misfielded flag join makes every
 * movement count, exactly as it would against a real database.
 */
function routeSum(
  params: string[]
): Array<{ partId: string; quantity: string; valueMinor: string }> {
  // Typed explicitly: TS 5.5+ infers an automatic type predicate for this
  // filter (narrowing to the literal union of PART_A/PART_B), which would
  // make `.has(m.partId)` below reject the wider `string` type.
  const requestedIds = new Set<string>(params.filter((p) => p === PART_A || p === PART_B))
  const flagJoined = params.includes(FIELD_IDS.adjustSubparts)

  const groups = new Map<string, { quantity: number; valueMinor: number }>()
  for (const m of h.movements) {
    if (!requestedIds.has(m.partId)) continue
    if (flagJoined && m.adjustSubparts === true) continue
    const g = groups.get(m.partId) ?? { quantity: 0, valueMinor: 0 }
    g.quantity += m.quantity
    g.valueMinor += m.extendedCost
    groups.set(m.partId, g)
  }

  return [...groups.entries()].map(([partId, g]) => ({
    partId,
    quantity: String(g.quantity),
    valueMinor: String(g.valueMinor),
  }))
}

/** Chainable Drizzle stub whose join conditions are inspected, not ignored. */
function chain(route: (params: string[]) => unknown[]) {
  const params: string[] = []
  const node: Record<string, unknown> = {}
  for (const key of ['select', 'from', 'where', 'groupBy']) node[key] = () => node
  for (const key of ['innerJoin', 'leftJoin']) {
    node[key] = (_alias: unknown, condition: unknown) => {
      boundStrings(condition, params)
      return node
    }
  }
  node.then = (resolve: (v: unknown) => unknown) => Promise.resolve(route(params)).then(resolve)
  return node
}

vi.mock('@auxx/database', () => ({
  schema: {
    FieldValue: {
      entityId: 'entityId',
      organizationId: 'organizationId',
      fieldId: 'fieldId',
      valueNumber: 'valueNumber',
      relatedEntityId: 'relatedEntityId',
    },
  },
}))
vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: string[]) =>
        Object.fromEntries(
          attrs.map((attr) => [attr, h.fieldsMissing ? null : (FIELDS[attr] ?? null)])
        ),
    }),
  }),
}))

import type { Database } from '@auxx/database'
import { readPartLedgerAverages } from '../cost-reads'

const fakeDb = { select: () => chain(routeSum) } as unknown as Database

beforeEach(() => {
  h.movements = []
  h.fieldsMissing = false
})

describe('readPartLedgerAverages', () => {
  it('empty input returns an empty Map without touching the database', async () => {
    const selectSpy = vi.fn()
    const db = { select: selectSpy } as unknown as Database

    const result = await readPartLedgerAverages(db, { organizationId: ORG, partInstanceIds: [] })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw result.error
    expect(result.value.size).toBe(0)
    expect(selectSpy).not.toHaveBeenCalled()
  })

  it('🛑 excludes a movement flagged adjust_subparts from both the value and quantity sums', async () => {
    h.movements = [
      { partId: PART_A, quantity: -5, extendedCost: -20_000 },
      // Exploded into children by bom-movement-triggers.ts - must not count
      // toward the part's own average (§3.4). Deliberately large and
      // opposite-signed so an accidental inclusion cannot pass by luck.
      { partId: PART_A, quantity: 500, extendedCost: 999_999, adjustSubparts: true },
    ]

    const result = await readPartLedgerAverages(fakeDb, {
      organizationId: ORG,
      partInstanceIds: [PART_A],
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw result.error
    expect(result.value.get(PART_A)).toEqual({
      partInstanceId: PART_A,
      valueMinor: -20_000,
      quantity: -5,
      unitCostMinor: null, // quantity <= 0, §3.6's fallback case
    })
  })

  it('computes a positive average, invariant under the arithmetic §3.3 item 1 proves', async () => {
    h.movements = [
      { partId: PART_A, quantity: 10, extendedCost: 40_000 }, // received
      { partId: PART_A, quantity: -4, extendedCost: -16_000 }, // relieved so far
    ]

    const result = await readPartLedgerAverages(fakeDb, {
      organizationId: ORG,
      partInstanceIds: [PART_A],
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw result.error
    expect(result.value.get(PART_A)).toEqual({
      partInstanceId: PART_A,
      valueMinor: 24_000,
      quantity: 6,
      unitCostMinor: 4_000,
    })
  })

  it('a part with no movements at all is ABSENT from the Map, not a zero row', async () => {
    h.movements = [{ partId: PART_A, quantity: 10, extendedCost: 40_000 }]

    const result = await readPartLedgerAverages(fakeDb, {
      organizationId: ORG,
      partInstanceIds: [PART_A, PART_B],
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw result.error
    expect(result.value.has(PART_A)).toBe(true)
    expect(result.value.has(PART_B)).toBe(false)
  })

  it('deduplicates repeated ids in the input before querying', async () => {
    h.movements = [{ partId: PART_A, quantity: 10, extendedCost: 40_000 }]

    const result = await readPartLedgerAverages(fakeDb, {
      organizationId: ORG,
      partInstanceIds: [PART_A, PART_A, PART_A],
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw result.error
    expect(result.value.size).toBe(1)
  })

  it('returns an error result when the org has not provisioned the required stock_movement fields', async () => {
    h.fieldsMissing = true

    const result = await readPartLedgerAverages(fakeDb, {
      organizationId: ORG,
      partInstanceIds: [PART_A],
    })

    expect(result.isErr()).toBe(true)
  })
})
