// packages/lib/src/inventory/receiving/__tests__/opening-inventory-adjustment.test.ts
//
// The opening inventory difference (the ledger's opening inventory against the parts'
// opening value) and the one adjustment that closes it (plans/accounting/tasks/103 §5a).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  cutoff: '2026-12' as string | null,
  roleAccounts: new Map<string, { glAccountId: string; code: string | null; name: string }>(),
  parts: { inventory_raw_materials: 0, inventory_wip: 0, inventory_finished_goods: 0 },
  partsOptions: [] as unknown[],
  opening: new Map<string, number>(),
  adjustment: new Map<string, number>(),
  postEntry: vi.fn(),
}))

vi.mock('../../../settings/read', () => ({
  readOrganizationSettings: async () => ({ 'accounting.cutoffPeriod': h.cutoff }),
}))

vi.mock('../../../accounting/ledger/roles/resolve-roles', () => ({
  loadRoleAccountCodes: async () => h.roleAccounts,
}))

vi.mock('../opening-stock-subledger', () => ({
  readOpeningStockSubledgerTotals: async (_db: unknown, _org: string, options: unknown) => {
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
  }),
}))

vi.mock('../../../accounting/ledger/post/post-entry', () => ({
  postEntry: async (_db: unknown, options: unknown) => {
    h.postEntry(options)
    return { status: 'posted', glPostingId: 'glp_adj' }
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

function posted() {
  return h.postEntry.mock.calls[0]![0] as {
    entry: { postingType: string; txnDate: string; lines: PostedLine[] }
    sources: { sourceKind: string; sourceId: string; occurrence: string; linkRole: string }[]
  }
}

beforeEach(() => {
  h.cutoff = '2026-12'
  // A provider-imported chart: all three inventory roles on one Inventory Asset.
  h.roleAccounts = new Map([
    ['inventory_raw_materials', account('inv')],
    ['inventory_wip', account('inv')],
    ['inventory_finished_goods', account('inv')],
  ])
  h.parts = { inventory_raw_materials: 300_00, inventory_wip: 0, inventory_finished_goods: 700_00 }
  h.partsOptions = []
  h.opening = new Map([['inv', 1_200_00]])
  h.adjustment = new Map()
  h.postEntry = vi.fn()
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
    expect(difference.differenceMinor).toBe(-200_00)
    expect(difference.adjustedMinor).toBe(0)
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
    expect(difference.differenceMinor).toBe(50_00)
  })

  it('counts an adjustment already posted as ledger, so the difference goes to zero', async () => {
    h.adjustment = new Map([['inv', -200_00]])
    const difference = (
      await readOpeningInventoryDifference(db, { organizationId: ORG })
    )._unsafeUnwrap()
    expect(difference.differenceMinor).toBe(0)
    expect(difference.adjustedMinor).toBe(-200_00)
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

  it('refuses without a cutoff month', async () => {
    h.cutoff = null
    expect((await readOpeningInventoryDifference(db, { organizationId: ORG })).isErr()).toBe(true)
  })
})

describe('postOpeningInventoryAdjustment', () => {
  it('posts one inventory entry the day after cutover, against inventory_revaluation', async () => {
    const outcome = (
      await postOpeningInventoryAdjustment(db, { organizationId: ORG, actorUserId: 'usr_1' })
    )._unsafeUnwrap()

    expect(outcome.post).toMatchObject({ status: 'posted', glPostingId: 'glp_adj' })
    const { entry, sources } = posted()
    expect(entry.postingType).toBe('inventory_movement')
    expect(entry.txnDate).toBe('2027-01-01')
    expect(entry.lines.map((line) => [line.accountRole, line.direction, line.amount])).toEqual([
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
        occurrence: 'inventory_adjustment:2026-12-31',
        linkRole: 'subject',
      },
    ])
  })

  it('debits inventory when the parts are worth more than the ledger holds', async () => {
    h.opening = new Map([['inv', 900_00]])
    await postOpeningInventoryAdjustment(db, { organizationId: ORG, actorUserId: 'usr_1' })
    expect(
      posted().entry.lines.map((line) => [line.accountRole, line.direction, line.amount])
    ).toEqual([
      ['inventory_raw_materials', 'debit', 100_00],
      ['inventory_revaluation', 'credit', 100_00],
    ])
  })

  it('posts nothing at a zero difference', async () => {
    h.opening = new Map([['inv', 1_000_00]])
    const outcome = (
      await postOpeningInventoryAdjustment(db, { organizationId: ORG, actorUserId: 'usr_1' })
    )._unsafeUnwrap()
    expect(outcome.post).toBeNull()
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('is idempotent: once the adjustment is in the ledger a re-run posts nothing', async () => {
    await postOpeningInventoryAdjustment(db, { organizationId: ORG, actorUserId: 'usr_1' })
    expect(h.postEntry).toHaveBeenCalledTimes(1)

    h.adjustment = new Map([['inv', -200_00]])
    const again = (
      await postOpeningInventoryAdjustment(db, { organizationId: ORG, actorUserId: 'usr_1' })
    )._unsafeUnwrap()
    expect(again.post).toBeNull()
    expect(h.postEntry).toHaveBeenCalledTimes(1)
  })

  it('moves value between separate accounts without a revaluation leg when they net to zero', async () => {
    h.roleAccounts = new Map([
      ['inventory_raw_materials', account('raw')],
      ['inventory_finished_goods', account('fg')],
    ])
    h.opening = new Map([
      ['raw', 400_00],
      ['fg', 600_00],
    ])
    await postOpeningInventoryAdjustment(db, { organizationId: ORG, actorUserId: 'usr_1' })
    expect(
      posted().entry.lines.map((line) => [line.accountRole, line.direction, line.amount])
    ).toEqual([
      ['inventory_raw_materials', 'credit', 100_00],
      ['inventory_finished_goods', 'debit', 100_00],
    ])
  })
})
