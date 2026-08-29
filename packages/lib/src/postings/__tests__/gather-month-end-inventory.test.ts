// packages/lib/src/postings/__tests__/gather-month-end-inventory.test.ts
//
// The reader half of the L1 month-end inventory entry, with the database faked.
//
// Two things are defended here, and everything below is a face of one of them:
//
//   1. **The prior snapshot is selected by the exact rule, or the close is
//      refused.** A WRONG prior still produces a perfectly balanced entry —
//      that is the whole reason `assertions.before` exists — so nothing
//      downstream can catch a broken selection. It has to be caught here.
//   2. **Nothing is ever defaulted, skipped, or coerced to zero.** A period at
//      or before the cutoff, a day key, an uncosted post-cutoff movement, an
//      unknown inventory role, a prior posting with no assertions: every one of
//      them refuses and names what to fix.
//
// 🛑 `@auxx/database` is re-mocked with the REAL schema barrel, following
// `approval-requests/__tests__/approval-request-queries.test.ts`. The default lib
// config mocks `schema` as a Proxy of empty objects (`src/test/setup.ts:76`), so
// every Drizzle column is `undefined` and every assertion on a predicate built
// from one passes VACUOUSLY. With the real tables in place the predicates can be
// rendered through `PgDialect` and the selection rule is actually asserted — a
// mutation that drops `status = 'posted'` or flips an `ORDER BY` to ascending
// changes the SQL text and fails.
//
// The window boundaries get the same treatment. They are the mechanical
// expression of "period membership is the accounting date in the BOOK
// timezone", and the only way to see them is in the bound parameters.

import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// See the header. Pure Drizzle, no connection.
vi.mock('@auxx/database', async () => {
  const schema = await import('../../../../database/src/db/schema/index')
  const enums = await import('../../../../database/src/enums')
  return { schema, ...enums, database: {} }
})

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
}))

vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: async (params: { key: string }) =>
    params.key in h.settings ? h.settings[params.key] : null,
  getAllOrganizationSettings: async () => {
    throw new Error('getAllOrganizationSettings is not the cached path')
  },
}))

vi.mock('../../cache', () => ({
  getCachedEntityDefId: async (_organizationId: string, entityType: string) =>
    entityType === 'stock_movement' ? 'def_stock_movement' : 'def_build',
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attributes: readonly string[]) =>
        Object.fromEntries(attributes.map((attribute) => [attribute, { id: `fld_${attribute}` }])),
    }),
  }),
}))

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { UnprocessableEntityError } from '../../errors'
import { buildPostingDraft } from '../draft'
import { gatherMonthEndInventoryInputs } from '../gather-month-end-inventory'
import { OPENING_BASELINE_SETTING_KEYS } from '../opening-baseline'

const ORG = 'org_1'
const K = OPENING_BASELINE_SETTING_KEYS

const OPENING = {
  inventory_raw_materials: 125_000,
  inventory_wip: 0,
  inventory_finished_goods: 480_050,
}

/** A finalized baseline: cutoff December 2026, books kept in New York. */
function validSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [K.setupState]: 'finalized',
    [K.cutoffPeriod]: '2026-12',
    [K.bookTimeZone]: 'America/New_York',
    [K.inventory_raw_materials]: OPENING.inventory_raw_materials,
    [K.inventory_wip]: OPENING.inventory_wip,
    [K.inventory_finished_goods]: OPENING.inventory_finished_goods,
    ...overrides,
  }
}

// ── The faked database ───────────────────────────────────────────────────────
//
// A chainable recorder. Each awaited chain is matched to one of the reader's
// four queries by the table it selects `from` and the shape of its projection,
// so the tests supply rows per QUERY rather than per call order — which matters,
// because three of them run inside one `Promise.all` and their resolution order
// is not fixed.

type Rows = Record<string, unknown>[]

interface RecordedQuery {
  table: unknown
  fields: Record<string, unknown>
  steps: Array<{ name: string; args: unknown[] }>
}

interface QueryResults {
  /** Rows for the prior-posting select. */
  glPostings?: Rows
  /** Rows for the rule-A offender scan. */
  offenders?: Rows
  /** Grouped `{ role, total, adjustTotal }` rows. */
  movementSums?: Rows
  /** The single `{ labor, overhead }` row. */
  buildSums?: Rows
}

let recorded: RecordedQuery[] = []

function rowsFor(state: RecordedQuery, results: QueryResults): Rows {
  if (state.table === schema.GlPosting) return results.glPostings ?? []
  const projection = Object.keys(state.fields)
  if (projection.includes('adjustTotal')) return results.movementSums ?? []
  if (projection.includes('labor')) return results.buildSums ?? []
  return results.offenders ?? []
}

function makeDb(results: QueryResults): Database {
  const chain = (state: RecordedQuery): unknown =>
    new Proxy(
      {},
      {
        get(_target, property: string) {
          if (property === 'then') {
            return (resolve: (rows: Rows) => void) => {
              recorded.push(state)
              resolve(rowsFor(state, results))
            }
          }
          return (...args: unknown[]) => {
            if (property === 'from') state.table = args[0]
            state.steps.push({ name: property, args })
            return chain(state)
          }
        },
      }
    )

  return {
    select: (fields: Record<string, unknown>) =>
      chain({ table: undefined, fields, steps: [{ name: 'select', args: [fields] }] }),
  } as unknown as Database
}

/** The one recorded chain whose projection contains `key`. */
function queryWith(key: string): RecordedQuery {
  const found = recorded.filter((query) => key in query.fields)
  if (found.length !== 1) {
    throw new Error(`expected exactly one query projecting ${key}, saw ${found.length}`)
  }
  return found[0] as RecordedQuery
}

/** The prior-posting select — the only one that reads `GlPosting`. */
function priorQuery(): RecordedQuery {
  const found = recorded.filter((query) => query.table === schema.GlPosting)
  if (found.length !== 1) {
    throw new Error(`expected exactly one GlPosting query, saw ${found.length}`)
  }
  return found[0] as RecordedQuery
}

const dialect = new PgDialect()

/** Every argument of `step` on this chain, rendered to SQL text and parameters. */
function rendered(query: RecordedQuery, step: string): { sql: string; params: unknown[] } {
  const args = query.steps.filter((s) => s.name === step).flatMap((s) => s.args)
  const parts = args.map((arg) => dialect.sqlToQuery(arg as never))
  return {
    sql: parts.map((part) => part.sql).join(' | '),
    params: parts.flatMap((part) => part.params),
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function snapshot(overrides: {
  raw?: number
  wip?: number
  finished?: number
  labor?: number
  overhead?: number
  adjustments?: number
}) {
  return {
    balances: {
      inventory_raw_materials: overrides.raw ?? 0,
      inventory_wip: overrides.wip ?? 0,
      inventory_finished_goods: overrides.finished ?? 0,
    },
    activityTotals: {
      absorbedLabor: overrides.labor ?? 0,
      absorbedOverhead: overrides.overhead ?? 0,
      inventoryAdjustments: overrides.adjustments ?? 0,
    },
  }
}

/** A `GlPosting` row as the prior-posting select reads it back. */
function priorRow(options: {
  docNumber?: string
  periodKey?: string
  revision?: number
  after?: ReturnType<typeof snapshot>
  before?: ReturnType<typeof snapshot>
  /** Set to drop the assertions entirely — the corrupt-chain case. */
  withoutAssertions?: boolean
}) {
  const draft = buildPostingDraft({
    docNumber: options.docNumber ?? 'JE-2026-07-ME',
    revision: options.revision ?? 0,
    entry: {} as never,
    resolvedLines: [],
    assertions: options.withoutAssertions
      ? undefined
      : {
          kind: 'month_end_inventory',
          before: options.before ?? snapshot({}),
          after: options.after ?? snapshot({}),
        },
  })
  return {
    docNumber: options.docNumber ?? 'JE-2026-07-ME',
    periodKey: options.periodKey ?? '2026-07',
    revision: options.revision ?? 0,
    draft,
  }
}

async function gather(results: QueryResults = {}, periodKey = '2027-08') {
  return gatherMonthEndInventoryInputs(makeDb(results), ORG, periodKey)
}

async function refusal(results: QueryResults = {}, periodKey = '2027-08'): Promise<string> {
  const result = await gather(results, periodKey)
  if (result.isOk()) throw new Error(`expected a refusal, got ${JSON.stringify(result.value)}`)
  expect(result.error).toBeInstanceOf(UnprocessableEntityError)
  return result.error.message
}

beforeEach(() => {
  h.settings = validSettings()
  recorded = []
})

// ── The cutover ──────────────────────────────────────────────────────────────

describe('the cutover close, which has no previous posting', () => {
  it('uses the frozen opening baseline as the prior, with all activity totals zero', async () => {
    const result = await gather({ glPostings: [] }, '2027-01')

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().prior).toEqual({
      balances: { ...OPENING },
      // Nothing has been absorbed or adjusted since a cutoff that has only just
      // happened. Zero here is a real answer, not a default.
      activityTotals: { absorbedLabor: 0, absorbedOverhead: 0, inventoryAdjustments: 0 },
    })
  })

  it('never manufactures a synthetic prior of zero balances', async () => {
    // The failure this refuses: reading a missing prior as `{0,0,0}` would post
    // the whole opening inventory as a January debit and balance perfectly.
    const inputs = (await gather({ glPostings: [] }, '2027-01'))._unsafeUnwrap()
    expect(inputs.prior.balances.inventory_raw_materials).toBe(125_000)
    expect(inputs.prior.balances.inventory_finished_goods).toBe(480_050)
  })
})

// ── The prior-row selection rule ─────────────────────────────────────────────

describe('the prior effective posting', () => {
  it("becomes the prior snapshot, verbatim, from its draft's assertions.after", async () => {
    const after = snapshot({ raw: 90_000, finished: 12_500, labor: 4_000, adjustments: -750 })
    const result = await gather({
      glPostings: [priorRow({ after, before: snapshot({ raw: 1 }) })],
    })

    expect(result._unsafeUnwrap().prior).toEqual(after)
  })

  it('selects the greatest periodKey strictly before this one, then the greatest revision', async () => {
    await gather({ glPostings: [priorRow({})] })

    const { sql, params } = rendered(priorQuery(), 'where')
    expect(sql).toContain('"periodKey" <')
    expect(params).toContain('2027-08')

    const order = rendered(priorQuery(), 'orderBy')
    // Both descending, periodKey first. Ascending on either one selects the
    // OLDEST prior, which still produces a balanced entry — so the direction is
    // exactly the kind of mistake nothing downstream can catch.
    expect(order.sql.toLowerCase()).toMatch(/"periodkey" desc.*"revision" desc/s)

    const limit = priorQuery().steps.find((step) => step.name === 'limit')
    expect(limit?.args).toEqual([1])
  })

  it('reads only `posted` rows of type `month_end_inventory`', async () => {
    await gather({ glPostings: [priorRow({})] })

    const { params } = rendered(priorQuery(), 'where')
    // `reversed` is the original of a reversal pair and must not be selected;
    // its effective reversal or re-entry is an ordinary `posted` row.
    expect(params).toContain('posted')
    expect(params).toContain('month_end_inventory')
    expect(params).toContain(ORG)
  })

  it('🛑 refuses a prior row whose draft carries no assertions, naming the document', async () => {
    // The corrupt chain. Falling back to the opening baseline here would restate
    // every month since the cutoff into one entry that balances perfectly.
    const message = await refusal({
      glPostings: [
        priorRow({ docNumber: 'JE-2027-07-ME', periodKey: '2027-07', withoutAssertions: true }),
      ],
    })

    expect(message).toContain('JE-2027-07-ME')
    expect(message).toContain('2027-07')
    expect(message).not.toContain('opening baseline as the prior')
  })
})

// ── The period ───────────────────────────────────────────────────────────────

describe('which periods may be closed', () => {
  it('refuses a period at the cutoff', async () => {
    const message = await refusal({}, '2026-12')
    expect(message).toContain('2026-12')
    expect(message).toContain('cutoff')
  })

  it('refuses a period before the cutoff', async () => {
    const message = await refusal({}, '2026-05')
    expect(message).toContain('cutoff')
  })

  it('accepts the very first month after the cutoff', async () => {
    const result = await gather({}, '2027-01')
    expect(result.isOk()).toBe(true)
  })

  it('refuses a day-granularity period key', async () => {
    const result = await gather({}, '2027-08-18')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('closes a month, not a day')
  })

  it('refuses a malformed period key', async () => {
    const result = await gather({}, '2027-8')
    expect(result.isErr()).toBe(true)
  })

  it('reads no baseline-dependent query when the period is refused', async () => {
    await gather({}, '2026-11')
    expect(recorded).toEqual([])
  })
})

// ── txnDate and the window, both in the book timezone ────────────────────────

describe('the accounting dates are derived in the book timezone', () => {
  it('sets txnDate to the last day of the period', async () => {
    expect((await gather({}, '2027-08'))._unsafeUnwrap().txnDate).toBe('2027-08-31')
    expect((await gather({}, '2027-02'))._unsafeUnwrap().txnDate).toBe('2027-02-28')
    expect((await gather({}, '2028-02'))._unsafeUnwrap().txnDate).toBe('2028-02-29')
  })

  it('🛑 bounds the movement window with INSTANTS, not with UTC calendar edges', async () => {
    await gather({}, '2027-08')

    const { params } = rendered(queryWith('adjustTotal'), 'where')
    // Midnight on 2027-01-01 in America/New_York is 05:00Z (EST); midnight on
    // 2027-09-01 there is 04:00Z (EDT). Deriving either boundary in UTC posts a
    // month's edge activity into the wrong month — invisible except at a close,
    // and uncorrectable once the period is locked.
    expect(params).toContain('2027-01-01T05:00:00.000Z')
    expect(params).toContain('2027-09-01T04:00:00.000Z')
  })

  it('moves the window when the book timezone moves', async () => {
    h.settings = validSettings({ [K.bookTimeZone]: 'Asia/Tokyo' })
    await gather({}, '2027-08')

    const { params } = rendered(queryWith('adjustTotal'), 'where')
    expect(params).toContain('2026-12-31T15:00:00.000Z')
    expect(params).toContain('2027-08-31T15:00:00.000Z')
  })

  it('bounds the build absorption window identically', async () => {
    await gather({}, '2027-08')

    const { params } = rendered(queryWith('labor'), 'where')
    expect(params).toContain('2027-01-01T05:00:00.000Z')
    expect(params).toContain('2027-09-01T04:00:00.000Z')
  })
})

// ── The cumulative current state ─────────────────────────────────────────────

describe('the cumulative current state', () => {
  it('adds the movement totals to the frozen opening balances, per role', async () => {
    const result = await gather({
      glPostings: [],
      movementSums: [
        { role: 'inventory_raw_materials', total: 25_000, adjustTotal: 0 },
        { role: 'inventory_finished_goods', total: -30_050, adjustTotal: 0 },
      ],
    })

    expect(result._unsafeUnwrap().current.balances).toEqual({
      inventory_raw_materials: 150_000,
      inventory_wip: 0,
      inventory_finished_goods: 450_000,
    })
  })

  it('keeps the adjustment total SEPARATE from the balance it also moved', async () => {
    // 🛑 The adjust movement legitimately appears in BOTH. It moved inventory,
    // so it is in the balance; `G12` requires count and shrinkage to be
    // classified into their own role, so it is also its own signed total. It is
    // never subtracted out of the balance.
    const result = await gather({
      glPostings: [],
      movementSums: [{ role: 'inventory_raw_materials', total: -4_000, adjustTotal: -4_000 }],
    })

    const { current } = result._unsafeUnwrap()
    expect(current.balances.inventory_raw_materials).toBe(121_000)
    expect(current.activityTotals.inventoryAdjustments).toBe(-4_000)
  })

  it('sums the adjustment total across every role', async () => {
    const result = await gather({
      glPostings: [],
      movementSums: [
        { role: 'inventory_raw_materials', total: -4_000, adjustTotal: -4_000 },
        { role: 'inventory_finished_goods', total: 1_000, adjustTotal: 1_000 },
      ],
    })

    expect(result._unsafeUnwrap().current.activityTotals.inventoryAdjustments).toBe(-3_000)
  })

  it('reads absorbed labour and overhead from the build rows, not the ledger', async () => {
    const result = await gather({
      glPostings: [],
      buildSums: [{ labor: 7_500, overhead: 2_250 }],
    })

    const { activityTotals } = result._unsafeUnwrap().current
    expect(activityTotals.absorbedLabor).toBe(7_500)
    expect(activityTotals.absorbedOverhead).toBe(2_250)
  })

  it('coerces a string aggregate, and rounds float representation away', async () => {
    const result = await gather({
      glPostings: [],
      movementSums: [
        { role: 'inventory_raw_materials', total: '25000', adjustTotal: '0' },
        { role: 'inventory_wip', total: 1_000.0000000001, adjustTotal: 0 },
      ],
    })

    const { balances } = result._unsafeUnwrap().current
    expect(balances.inventory_raw_materials).toBe(150_000)
    expect(balances.inventory_wip).toBe(1_000)
  })

  it('refuses a non-finite aggregate rather than rounding it', async () => {
    const message = await refusal({
      glPostings: [],
      movementSums: [{ role: 'inventory_raw_materials', total: 'not a number', adjustTotal: 0 }],
    })
    expect(message).toContain('not a finite number')
  })
})

// ── Rule A ───────────────────────────────────────────────────────────────────

describe('rule A — a post-cutoff uncosted movement fails the close', () => {
  it('refuses, naming the offending movement', async () => {
    const message = await refusal({ offenders: [{ id: 'mv_bad_1' }, { id: 'mv_bad_2' }] })

    expect(message).toContain('mv_bad_1')
    expect(message).toContain('mv_bad_2')
    expect(message).toContain('outside those')
  })

  it('names at most ten, and says there are more', async () => {
    const many = Array.from({ length: 11 }, (_unused, index) => ({ id: `mv_${index}` }))
    const message = await refusal({ offenders: many })

    expect(message).toContain('(and more)')
    expect(message).not.toContain('mv_10')
  })

  it('scans with LEFT joins, so an uncosted movement is visible to the scan', async () => {
    // 🛑 An INNER join on the cost fields makes exactly the rows this scan is
    // looking for invisible to it — rule A's failure mode expressed in SQL.
    await gather({})
    const scan = recorded.filter(
      (query) => Object.keys(query.fields).length === 1 && 'id' in query.fields
    )
    expect(scan).toHaveLength(1)
    const joins = (scan[0] as RecordedQuery).steps.map((step) => step.name)
    expect(joins.filter((name) => name === 'innerJoin')).toEqual([])
    expect(joins.filter((name) => name === 'leftJoin').length).toBeGreaterThanOrEqual(4)
  })

  it('refuses a role the chart cannot value, even if the scan let it through', async () => {
    // Belt and braces: the scan above already refuses an unrecognised role. This
    // is the second gate, so a later edit to the scan cannot silently drop a
    // whole account's worth of inventory into the COGS plug.
    const message = await refusal({
      glPostings: [],
      movementSums: [{ role: 'inventory_consigned', total: 9_999, adjustTotal: 0 }],
    })
    expect(message).toContain('inventory_consigned')
    expect(message).toContain('unknown inventory role')
  })
})

// ── The baseline gate ────────────────────────────────────────────────────────

describe('it refuses before it reads when the baseline is not usable', () => {
  it('passes the opening baseline refusal straight through', async () => {
    h.settings = validSettings({ [K.setupState]: 'draft' })
    const message = await refusal()
    expect(message).toContain('not finalized')
    expect(recorded).toEqual([])
  })

  it('refuses an unrecognised book timezone rather than deriving the window in UTC', async () => {
    h.settings = validSettings({ [K.bookTimeZone]: 'Mars/Olympus_Mons' })
    const message = await refusal()
    expect(message).toContain('IANA zone')
    expect(recorded).toEqual([])
  })
})
