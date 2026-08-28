// packages/lib/src/bom/subpart-graph.test.ts
//
// Cover for plans/products/build/README.md B4: a build consumes its part's DIRECT
// subparts only, so `loadDirectSubparts` must stop at depth 1 while
// `loadSubpartGraph` + `getDeductionTargets` keep walking every descendant.
// The two live side by side precisely so the difference is visible, and this
// file pins the depth-1 half of that contract.
//
// The harness mocks `drizzle-orm`'s predicate builders into plain descriptors and
// runs a tiny join evaluator over an in-memory subpart table, so the assertions
// exercise the query's real scoping (org, def, archived, parent) rather than the
// JS post-processing alone.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG = 'org_1'
const SUBPART_DEF = 'subpart_def'

interface SubpartRow {
  id: string
  organizationId: string
  entityDefinitionId: string
  archivedAt: Date | null
  parent: string
  child: string
  qty: number | null
}

/** A column reference the fake evaluator can resolve: `{ table, column }`. */
function tableRef(name: string): Record<string, { table: string; column: string }> & {
  __name: string
} {
  return new Proxy({} as never, {
    get(_t, prop: string) {
      if (prop === '__name') return name
      return { table: name, column: prop }
    },
  })
}

vi.mock('drizzle-orm', () => ({
  and: (...conds: unknown[]) => ({ op: 'and', conds: conds.filter(Boolean) }),
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  isNull: (col: unknown) => ({ op: 'isNull', col }),
  // `loadSubpartGraph`'s recursive CTE template — never invoked by these tests.
  sql: Object.assign(() => ({}), { join: () => ({}), raw: () => ({}) }),
}))

vi.mock('drizzle-orm/pg-core', () => ({
  alias: (_table: unknown, name: string) => tableRef(name),
}))

vi.mock('@auxx/database', () => ({
  database: {},
  schema: {
    EntityInstance: tableRef('EntityInstance'),
    FieldValue: tableRef('FieldValue'),
  },
}))

const FIELD: Record<string, { id: string; type: string }> = {
  subpart_parent_part: { id: 'f_sp_parent', type: 'RELATIONSHIP' },
  subpart_child_part: { id: 'f_sp_child', type: 'RELATIONSHIP' },
  subpart_quantity: { id: 'f_sp_qty', type: 'NUMBER' },
}

const missingFields = { value: false }

vi.mock('../cache', () => ({
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(attrs.map((a) => [a, missingFields.value ? null : (FIELD[a] ?? null)])),
    }),
  }),
  requireCachedEntityDefId: async (_orgId: string, entityType: string) => `${entityType}_def`,
}))

import { loadDirectSubparts } from './subpart-graph'

// ─── The fake db ─────────────────────────────────────────────────────

type Binding = Record<string, Record<string, unknown>>

function isColumnRef(x: unknown): x is { table: string; column: string } {
  return typeof x === 'object' && x !== null && 'table' in x && 'column' in x
}

/** Resolve either side of a comparison: a column reference, or a literal. */
function resolve(operand: any, binding: Binding): unknown {
  if (!isColumnRef(operand)) return operand
  return binding[operand.table]?.[operand.column]
}

function evaluate(pred: any, binding: Binding): boolean {
  if (!pred) return true
  if (pred.op === 'and') return pred.conds.every((c: unknown) => evaluate(c, binding))
  if (pred.op === 'eq') return resolve(pred.col, binding) === resolve(pred.val, binding)
  if (pred.op === 'isNull') return resolve(pred.col, binding) == null
  throw new Error(`unhandled predicate: ${JSON.stringify(pred)}`)
}

/** Every FieldValue row implied by the in-memory subpart table. */
function fieldValueRows(rows: SubpartRow[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const r of rows) {
    out.push({
      entityId: r.id,
      fieldId: 'f_sp_parent',
      organizationId: r.organizationId,
      relatedEntityId: r.parent,
      valueNumber: null,
    })
    out.push({
      entityId: r.id,
      fieldId: 'f_sp_child',
      organizationId: r.organizationId,
      relatedEntityId: r.child,
      valueNumber: null,
    })
    out.push({
      entityId: r.id,
      fieldId: 'f_sp_qty',
      organizationId: r.organizationId,
      relatedEntityId: null,
      valueNumber: r.qty,
    })
  }
  return out
}

function makeDb(rows: SubpartRow[]) {
  const fvs = fieldValueRows(rows)
  const instances = rows.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    entityDefinitionId: r.entityDefinitionId,
    archivedAt: r.archivedAt,
  }))

  return {
    select(projection: Record<string, any>) {
      let bindings: Binding[] = []
      const builder = {
        from() {
          bindings = instances.map((ei) => ({ EntityInstance: ei }))
          return builder
        },
        innerJoin(aliased: { __name: string }, pred: unknown) {
          const next: Binding[] = []
          for (const b of bindings) {
            for (const fv of fvs) {
              const candidate = { ...b, [aliased.__name]: fv }
              if (evaluate(pred, candidate)) next.push(candidate)
            }
          }
          bindings = next
          return builder
        },
        where(pred: unknown) {
          const kept = bindings.filter((b) => evaluate(pred, b))
          return Promise.resolve(
            kept.map((b) =>
              Object.fromEntries(
                Object.entries(projection).map(([key, col]) => [key, resolve(col, b)])
              )
            )
          )
        },
      }
      return builder
    },
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────

const LIFT = 'part_lift'
const ASSEMBLY = 'part_assembly'
const MOTOR = 'part_motor'
const TUBE = 'part_tube'
const BRACKET = 'part_bracket'

function edge(overrides: Partial<SubpartRow> & Pick<SubpartRow, 'id' | 'parent' | 'child'>) {
  return {
    organizationId: ORG,
    entityDefinitionId: SUBPART_DEF,
    archivedAt: null,
    qty: 1,
    ...overrides,
  } satisfies SubpartRow
}

describe('loadDirectSubparts', () => {
  beforeEach(() => {
    missingFields.value = false
  })

  it('returns a part’s direct children with their quantities', async () => {
    const db = makeDb([
      edge({ id: 'sp1', parent: LIFT, child: MOTOR, qty: 2 }),
      edge({ id: 'sp2', parent: LIFT, child: TUBE, qty: 4 }),
    ])

    const result = await loadDirectSubparts(db as never, ORG, LIFT)

    expect(result).toHaveLength(2)
    expect(result).toEqual(
      expect.arrayContaining([
        { childId: MOTOR, qty: 2 },
        { childId: TUBE, qty: 4 },
      ])
    )
  })

  it('returns the subassembly itself, NOT its children (B4: depth 1 only)', async () => {
    const db = makeDb([
      // LIFT -> 2x ASSEMBLY
      edge({ id: 'sp1', parent: LIFT, child: ASSEMBLY, qty: 2 }),
      // ASSEMBLY -> MOTOR + TUBE. A recursive walk would surface these.
      edge({ id: 'sp2', parent: ASSEMBLY, child: MOTOR, qty: 1 }),
      edge({ id: 'sp3', parent: ASSEMBLY, child: TUBE, qty: 3 }),
    ])

    const result = await loadDirectSubparts(db as never, ORG, LIFT)

    expect(result).toEqual([{ childId: ASSEMBLY, qty: 2 }])
    expect(result.map((r) => r.childId)).not.toContain(MOTOR)
    expect(result.map((r) => r.childId)).not.toContain(TUBE)
  })

  it('returns an empty list for a part with no subparts', async () => {
    const db = makeDb([edge({ id: 'sp1', parent: ASSEMBLY, child: MOTOR, qty: 1 })])

    const result = await loadDirectSubparts(db as never, ORG, BRACKET)

    expect(result).toEqual([])
  })

  it('skips archived subpart rows, other orgs, and non-positive quantities', async () => {
    const db = makeDb([
      edge({ id: 'sp1', parent: LIFT, child: MOTOR, qty: 2 }),
      edge({ id: 'sp2', parent: LIFT, child: TUBE, archivedAt: new Date() }),
      edge({ id: 'sp3', parent: LIFT, child: BRACKET, organizationId: 'org_2' }),
      edge({ id: 'sp4', parent: LIFT, child: ASSEMBLY, qty: 0 }),
    ])

    const result = await loadDirectSubparts(db as never, ORG, LIFT)

    expect(result).toEqual([{ childId: MOTOR, qty: 2 }])
  })

  it('returns an empty list when the subpart fields are not materialized', async () => {
    missingFields.value = true
    const db = makeDb([edge({ id: 'sp1', parent: LIFT, child: MOTOR, qty: 2 })])

    const result = await loadDirectSubparts(db as never, ORG, LIFT)

    expect(result).toEqual([])
  })
})
