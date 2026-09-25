// packages/lib/src/inventory/receiving/__tests__/opening-inventory-adjustment.test.ts
//
// The opening inventory difference — the books' opening inventory against the parts' value at
// the cutover — and the repeatable, delta-only entry that closes it (111 Q19/Q23).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  roleAccounts: new Map<string, { glAccountId: string; code: string | null; name: string }>(),
  parts: {
    byRole: { inventory_raw_materials: 0, inventory_wip: 0, inventory_finished_goods: 0 },
    totalMinor: 0,
    byPart: [] as unknown[],
    uncounted: [] as unknown[],
    pendingRows: 0,
  },
  partsOptions: [] as unknown[],
  opening: new Map<string, number>(),
  adjustment: new Map<string, number>(),
  differenceEntries: 0,
  postEntry: vi.fn(),
  postStatus: 'posted' as string,
}))

vi.mock('../../../settings/read', () => ({
  readOrganizationSettings: async (_org: string, keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, h.settings[key] ?? null])),
}))

vi.mock('../../../accounting/ledger/roles/resolve-roles', () => ({
  loadRoleAccountCodes: async () => h.roleAccounts,
}))

vi.mock('../opening-stock-subledger', () => ({
  readPartsValueAtCutover: async (_db: unknown, _org: string, options: unknown) => {
    h.partsOptions.push(options)
    const { ok } = await import('neverthrow')
    return ok(h.parts)
  },
}))

vi.mock('../../../accounting/ledger/reads/opening-inventory', () => ({
  OPENING_INVENTORY_ADJUSTMENT_SOURCE: 'opening_inventory_adjustment',
  readOpeningInventoryLedger: async () => ({
    openingByAccount: h.opening,
    adjustmentByAccount: h.adjustment,
    differenceEntries: h.differenceEntries,
  }),
}))

vi.mock('../../../accounting/ledger/post/post-entry', () => ({
  postEntry: async (_db: unknown, options: unknown) => {
    h.postEntry(options)
    return h.postStatus === 'posted'
      ? { status: 'posted', glPostingId: 'glp_adj' }
      : { status: h.postStatus, error: 'Period closed' }
  },
}))

import { postOpeningInventoryAdjustment } from '../opening-inventory-adjustment'
import { readOpeningInventoryDifference } from '../opening-inventory-difference'

const db = {} as never
const ORG = 'org_1'

function account(glAccountId: string) {
  return { glAccountId, code: null, name: glAccountId }
}

interface PostedLine {
  accountRole: string
  direction: 'debit' | 'credit'
  amount: number
  sourceType: string
}

function posted(call = 0) {
  return h.postEntry.mock.calls[call]![0] as {
    memo: string
    entry: { postingType: string; txnDate: string; lines: PostedLine[] }
    sources: { sourceKind: string; sourceId: string; occurrence: string; linkRole: string }[]
  }
}

function legs(call = 0) {
  return posted(call).entry.lines.map((line) => [line.accountRole, line.direction, line.amount])
}

beforeEach(() => {
  h.settings = {
    'accounting.cutoffPeriod': '2026-12',
    'accounting.openingInventoryInBooks': 'revaluation',
    'organization.currency': 'USD',
  }
  // A provider-imported chart: all three inventory roles on one Inventory Asset.
  h.roleAccounts = new Map([
    ['inventory_raw_materials', account('inv')],
    ['inventory_wip', account('inv')],
    ['inventory_finished_goods', account('inv')],
  ])
  h.parts = {
    byRole: { inventory_raw_materials: 300_00, inventory_wip: 0, inventory_finished_goods: 700_00 },
    totalMinor: 1_000_00,
    byPart: [{ partId: 'p1', name: 'Bolt', qtyAtCutover: 10, valueMinor: 1_000_00 }],
    uncounted: [{ partId: 'p2', name: 'Nut', throughputAtCutover: 40 }],
    pendingRows: 2,
  }
  h.partsOptions = []
  h.opening = new Map([['inv', 1_200_00]])
  h.adjustment = new Map()
  h.differenceEntries = 0
  h.postEntry = vi.fn()
  h.postStatus = 'posted'
})

describe('readOpeningInventoryDifference', () => {
  it('compares the parts at cutover with the opening entry, per shared account', async () => {
    const difference = (
      await readOpeningInventoryDifference(db, { organizationId: ORG })
    )._unsafeUnwrap()

    expect(h.partsOptions).toEqual([{ onOrBefore: '2026-12-31' }])
    expect(difference.cutoverDate).toBe('2026-12-31')
    expect(difference.rows).toEqual([
      {
        glAccountId: 'inv',
        roles: ['inventory_raw_materials', 'inventory_wip', 'inventory_finished_goods'],
        ledgerMinor: 1_200_00,
        partsMinor: 1_000_00,
        differenceMinor: -200_00,
      },
    ])
    expect(difference).toMatchObject({
      providerOpeningMinor: 1_200_00,
      postedDifferencesMinor: 0,
      postedDifferenceCount: 0,
      partsValueAtCutoverMinor: 1_000_00,
      deltaMinor: -200_00,
      inBooks: 'revaluation',
      needsAnswer: false,
      pendingRows: 2,
    })
    expect(difference.byPart).toEqual(h.parts.byPart)
    expect(difference.uncounted).toEqual(h.parts.uncounted)
  })

  it('reports one row per account when the roles have their own accounts', async () => {
    h.roleAccounts = new Map([
      ['inventory_raw_materials', account('raw')],
      ['inventory_wip', account('wip')],
      ['inventory_finished_goods', account('fg')],
    ])
    h.opening = new Map([
      ['raw', 250_00],
      ['fg', 700_00],
    ])
    const difference = (
      await readOpeningInventoryDifference(db, { organizationId: ORG })
    )._unsafeUnwrap()
    expect(difference.rows.map((row) => [row.glAccountId, row.differenceMinor])).toEqual([
      ['raw', 50_00],
      ['wip', 0],
      ['fg', 0],
    ])
    expect(difference.deltaMinor).toBe(50_00)
  })

  it('takes the difference entries already posted as books: delta = parts − (provider + posted)', async () => {
    h.adjustment = new Map([['inv', -200_00]])
    h.differenceEntries = 1
    const difference = (
      await readOpeningInventoryDifference(db, { organizationId: ORG })
    )._unsafeUnwrap()
    expect(difference.deltaMinor).toBe(0)
    expect(difference.postedDifferencesMinor).toBe(-200_00)
    expect(difference.postedDifferenceCount).toBe(1)
  })

  it('keeps an unmapped role that holds parts, and drops one that holds none', async () => {
    h.roleAccounts = new Map([['inventory_finished_goods', account('fg')]])
    h.opening = new Map([['fg', 700_00]])
    const difference = (
      await readOpeningInventoryDifference(db, { organizationId: ORG })
    )._unsafeUnwrap()
    expect(difference.rows.map((row) => [row.glAccountId, row.roles, row.differenceMinor])).toEqual(
      [
        [null, ['inventory_raw_materials'], 300_00],
        ['fg', ['inventory_finished_goods'], 0],
      ]
    )
  })

  it('reports needsAnswer while the in-books setting is unset', async () => {
    h.settings['accounting.openingInventoryInBooks'] = null
    const difference = (
      await readOpeningInventoryDifference(db, { organizationId: ORG })
    )._unsafeUnwrap()
    expect(difference.needsAnswer).toBe(true)
    expect(difference.inBooks).toBeNull()
  })

  it('refuses without a cutoff month', async () => {
    h.settings['accounting.cutoffPeriod'] = null
    expect((await readOpeningInventoryDifference(db, { organizationId: ORG })).isErr()).toBe(true)
  })
})

describe('postOpeningInventoryAdjustment', () => {
  it('posts the delta the day after cutover against inventory_revaluation, numbered per press', async () => {
    const outcome = (
      await postOpeningInventoryAdjustment(db, { organizationId: ORG, actorUserId: 'usr_1' })
    )._unsafeUnwrap()

    expect(outcome).toMatchObject({ outcome: 'posted', glPostingId: 'glp_adj' })
    const { entry, sources, memo } = posted()
    expect(entry.postingType).toBe('inventory_movement')
    expect(entry.txnDate).toBe('2027-01-01')
    expect(legs()).toEqual([
      ['inventory_raw_materials', 'credit', 200_00],
      ['inventory_revaluation', 'debit', 200_00],
    ])
    expect(entry.lines.every((line) => line.sourceType === 'opening_inventory_adjustment')).toBe(
      true
    )
    expect(sources).toEqual([
      {
        sourceKind: 'opening_balance',
        sourceId: ORG,
        occurrence: 'inventory_adjustment:2026-12-31:1',
        linkRole: 'subject',
      },
    ])
    expect(memo).toBe(
      'Opening inventory difference #1: parts at cutover 1000.00 USD vs books 1200.00 USD'
    )
  })

  it('credits Opening Balance Equity when the inventory was never on the old books', async () => {
    h.settings['accounting.openingInventoryInBooks'] = 'opening_equity'
    h.opening = new Map([['inv', 900_00]])
    await postOpeningInventoryAdjustment(db, { organizationId: ORG, actorUserId: 'usr_1' })
    expect(legs()).toEqual([
      ['inventory_raw_materials', 'debit', 100_00],
      ['equity_opening_balance', 'credit', 100_00],
    ])
  })

  it('refuses until the in-books question is answered', async () => {
    h.settings['accounting.openingInventoryInBooks'] = null
    const result = await postOpeningInventoryAdjustment(db, {
      organizationId: ORG,
      actorUserId: 'usr_1',
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('accounting.openingInventoryInBooks')
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('has nothing to post at a zero delta', async () => {
    h.opening = new Map([['inv', 1_000_00]])
    const outcome = (
      await postOpeningInventoryAdjustment(db, { organizationId: ORG, actorUserId: 'usr_1' })
    )._unsafeUnwrap()
    expect(outcome.outcome).toBe('nothing_to_post')
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('a second press after a count posts only the new delta, under the next occurrence', async () => {
    await postOpeningInventoryAdjustment(db, { organizationId: ORG, actorUserId: 'usr_1' })
    expect(posted(0).sources[0]!.occurrence).toBe('inventory_adjustment:2026-12-31:1')

    // The first entry landed; a Set count then raised the parts at the cutover by 50.
    h.adjustment = new Map([['inv', -200_00]])
    h.differenceEntries = 1
    h.parts = {
      ...h.parts,
      byRole: { ...h.parts.byRole, inventory_raw_materials: 350_00 },
      totalMinor: 1_050_00,
    }
    const again = (
      await postOpeningInventoryAdjustment(db, { organizationId: ORG, actorUserId: 'usr_1' })
    )._unsafeUnwrap()
    expect(again.outcome).toBe('posted')
    expect(legs(1)).toEqual([
      ['inventory_raw_materials', 'debit', 50_00],
      ['inventory_revaluation', 'credit', 50_00],
    ])
    expect(posted(1).sources[0]!.occurrence).toBe('inventory_adjustment:2026-12-31:2')
    expect(posted(1).memo).toContain('#2: parts at cutover 1050.00 USD vs books 1000.00 USD')
  })

  it('moves value between separate accounts without a credit leg when they net to zero', async () => {
    h.roleAccounts = new Map([
      ['inventory_raw_materials', account('raw')],
      ['inventory_finished_goods', account('fg')],
    ])
    h.opening = new Map([
      ['raw', 400_00],
      ['fg', 600_00],
    ])
    await postOpeningInventoryAdjustment(db, { organizationId: ORG, actorUserId: 'usr_1' })
    expect(legs()).toEqual([
      ['inventory_raw_materials', 'credit', 100_00],
      ['inventory_finished_goods', 'debit', 100_00],
    ])
  })

  it('surfaces a ledger refusal as an error rather than a posted outcome', async () => {
    h.postStatus = 'period_closed'
    const result = await postOpeningInventoryAdjustment(db, {
      organizationId: ORG,
      actorUserId: 'usr_1',
    })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toBe('Period closed')
  })
})
