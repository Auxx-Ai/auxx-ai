// packages/lib/src/postings/__tests__/default-chart.test.ts
//
// The chart is DATA, so these are the assertions data can break silently.
//
// The first block used to pin `ACCOUNT_ROLES` against `GlAccountRole` - two
// copies of one vocabulary, kept honest by exact-set equality. Decision `G19`
// deleted the second copy along with the `gl_account.role` SINGLE_SELECT it
// existed to populate, so the vocabulary now has ONE home. What replaces that
// test is the same shape aimed at the two satellite tables that would otherwise
// drift instead: `ROLE_ACCOUNT_TYPES` and `ACCOUNT_ROLE_LABELS`, both keyed by
// role, and both of which a new role must be added to in the same change.
//
// Brief 16 split the chart into packs. The union pins below run over
// `DEFAULT_CHART_OF_ACCOUNTS` (every pack flattened); the per-pack pins are
// what stop a role drifting from the pack whose builders drive it.
//
// Only an EXACT-set assertion catches a removal; a subset assertion passes
// forever.

import { describe, expect, it } from 'vitest'
import { GlAccountType } from '../../resources/registry/enum-values'
import { ACCOUNT_ROLE_LABELS, ACCOUNT_ROLES, ROLE_ACCOUNT_TYPES } from '../build-entry'
import {
  CHART_PACK_KEYS,
  CHART_PACKS,
  type ChartPackKey,
  DEFAULT_CHART_OF_ACCOUNTS,
  packForRole,
  packState,
} from '../default-chart'
import type { RoleAssignmentRow } from '../types'

const CODE_ROLE_VALUES = Object.values(ACCOUNT_ROLES)

const rolesOf = (pack: ChartPackKey) =>
  CHART_PACKS[pack].accounts.flatMap((account) => (account.role ? [account.role] : []))

const codesOf = (pack: ChartPackKey) => CHART_PACKS[pack].accounts.map((account) => account.code)

const byCode = new Map(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.code, a]))

describe('the role vocabulary is one vocabulary', () => {
  it('declares no role twice', () => {
    expect(new Set(CODE_ROLE_VALUES).size).toBe(CODE_ROLE_VALUES.length)
  })

  // A role with no declared account type resolves UNCHECKED: `resolveRoles`
  // would have nothing to compare the account against, so pointing `grni` at a
  // revenue account would post and balance. Exact equality, both directions.
  it('declares a permitted account type for exactly the roles that exist', () => {
    expect(Object.keys(ROLE_ACCOUNT_TYPES).sort()).toEqual([...CODE_ROLE_VALUES].sort())
  })

  it('permits only the five statement classifications', () => {
    const types = new Set<string>(GlAccountType.values.map((option) => option.value))
    for (const [role, accountType] of Object.entries(ROLE_ACCOUNT_TYPES)) {
      expect(types.has(accountType), `role ${role} -> ${accountType}`).toBe(true)
    }
  })

  it('gives every role a human label - the build ledger renders one', () => {
    expect(Object.keys(ACCOUNT_ROLE_LABELS).sort()).toEqual([...CODE_ROLE_VALUES].sort())
    for (const [role, label] of Object.entries(ACCOUNT_ROLE_LABELS)) {
      expect(label.trim(), `role ${role}`).toBeTruthy()
    }
  })
})

describe('the chart agrees with the declared account types', () => {
  // The seeded default must satisfy the very check `resolveRoles` runs at a
  // close. A chart that ships a role on an account of the wrong type would make
  // every org fail closed on its first posting, with no edit of their own to
  // blame.
  it('seeds every role onto an account of its permitted type', () => {
    for (const account of DEFAULT_CHART_OF_ACCOUNTS) {
      if (!account.role) continue
      expect(account.accountType, `${account.code} ${account.role}`).toBe(
        ROLE_ACCOUNT_TYPES[account.role]
      )
    }
  })
})

describe('the union of every pack', () => {
  it('is the packs flattened in declaration order, core first', () => {
    expect(CHART_PACK_KEYS[0]).toBe('core')
    expect(CHART_PACK_KEYS).toEqual(Object.keys(CHART_PACKS))
    expect(DEFAULT_CHART_OF_ACCOUNTS).toEqual(
      CHART_PACK_KEYS.flatMap(codesOf).map((c) => byCode.get(c))
    )
  })

  it('has a unique code per account - `code` is the org-unique identity', () => {
    const codes = DEFAULT_CHART_OF_ACCOUNTS.map((account) => account.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('gives every account a code, a name and a statement type', () => {
    const types = new Set<string>(GlAccountType.values.map((option) => option.value))
    for (const account of DEFAULT_CHART_OF_ACCOUNTS) {
      expect(account.code.trim(), account.code).toBeTruthy()
      expect(account.name.trim(), account.code).toBeTruthy()
      expect(types.has(account.accountType), `${account.code} ${account.accountType}`).toBe(true)
    }
  })

  // THE uniqueness rule the `role` field's `unique: true` capability enforces at
  // the write door, and the other half: a role no account carries is a builder
  // that cannot post. `assertAccountRolesResolve` would fail the entry with
  // `account_unmapped` before the period was claimed - correct behaviour, but it
  // should never be reachable from the DEFAULT chart, which is the whole point
  // of shipping the roles pre-assigned (`G8`). Exact set, both directions.
  it('assigns every role in ACCOUNT_ROLES exactly once', () => {
    const assigned = DEFAULT_CHART_OF_ACCOUNTS.flatMap((account) =>
      account.role ? [account.role] : []
    )
    expect(new Set(assigned).size).toBe(assigned.length)
    expect([...assigned].sort()).toEqual([...CODE_ROLE_VALUES].sort())
  })

  // The four LFK-only accounts brief 16 dropped (DECIDED, 16.3). Role-less and
  // one company's bookkeeping; an org adds them by hand where wanted. Pinned so
  // they are not quietly parked in a pack.
  it('carries none of the four dropped accounts', () => {
    for (const code of ['1190', '2100', '2400', '6200']) {
      expect(byCode.has(code), code).toBe(false)
    }
  })

  it('totals thirty-three accounts: thirteen core, five, two, nine and four', () => {
    expect(codesOf('core')).toHaveLength(13)
    expect(codesOf('card_rail')).toHaveLength(5)
    expect(codesOf('prepayments')).toHaveLength(2)
    expect(codesOf('inventory')).toHaveLength(9)
    expect(codesOf('purchasing')).toHaveLength(4)
    expect(DEFAULT_CHART_OF_ACCOUNTS).toHaveLength(33)
  })
})

describe('the core', () => {
  // Brief 16 §1.3. A role added to the core later has to argue with this test:
  // every one of these is reachable by an ENABLED posting type on any org that
  // sends an invoice, takes a payment, ships an order, issues a credit memo or
  // writes something off. Exact set.
  it('carries exactly the eleven roles every org can reach', () => {
    expect([...rolesOf('core')].sort()).toEqual(
      [
        ACCOUNT_ROLES.UNDEPOSITED_FUNDS,
        ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE,
        ACCOUNT_ROLES.ACCOUNTS_PAYABLE,
        ACCOUNT_ROLES.SALES_TAX_PAYABLE,
        ACCOUNT_ROLES.EQUITY_RETAINED_EARNINGS,
        ACCOUNT_ROLES.EQUITY_OPENING_BALANCE,
        ACCOUNT_ROLES.REVENUE_PRODUCT,
        ACCOUNT_ROLES.REVENUE_SHIPPING,
        ACCOUNT_ROLES.REVENUE_SERVICE,
        ACCOUNT_ROLES.REVENUE_RETURNS_ALLOWANCES,
        ACCOUNT_ROLES.BAD_DEBT_EXPENSE,
      ].sort()
    )
  })

  it('is exactly the thirteen accounts §1.3 names', () => {
    expect(codesOf('core')).toEqual([
      '1000',
      '1050',
      '1100',
      '2000',
      '2200',
      '3000',
      '3100',
      '3900',
      '4000',
      '4020',
      '4030',
      '4090',
      '6300',
    ])
  })

  // `cash` retired as a posting role (brief 13 §2): `1000 Cash` is kept as an
  // ordinary bank account, mappable like any other, and carries no role at all.
  it('keeps 1000 Cash as a plain bank account, with no role', () => {
    expect(byCode.get('1000')?.role).toBeUndefined()
    expect(byCode.get('1000')?.subtype).toBe('bank')
  })

  it('stamps the receivable and payable subtypes the QuickBooks seam reads', () => {
    expect(byCode.get('1100')?.subtype).toBe('accounts_receivable')
    expect(byCode.get('2000')?.subtype).toBe('accounts_payable')
  })

  it('names 1100 plainly - one receivable whatever the channel (handoff 6.1)', () => {
    expect(byCode.get('1100')?.name).toBe('Accounts Receivable')
    expect(byCode.get('1100')?.role).toBe(ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)
  })
})

describe('the other packs', () => {
  it('put every non-core role in the pack whose builders drive it', () => {
    expect([...rolesOf('card_rail')].sort()).toEqual(
      [
        ACCOUNT_ROLES.CLEARING_CARD,
        ACCOUNT_ROLES.CLEARING_AFFIRM,
        ACCOUNT_ROLES.UNIDENTIFIED_RECEIPTS,
        ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES,
      ].sort()
    )
    expect([...rolesOf('prepayments')].sort()).toEqual(
      [ACCOUNT_ROLES.DEFERRED_REVENUE, ACCOUNT_ROLES.CUSTOMER_DEPOSITS].sort()
    )
    expect([...rolesOf('inventory')].sort()).toEqual(
      [
        ACCOUNT_ROLES.INVENTORY_RAW_MATERIALS,
        ACCOUNT_ROLES.INVENTORY_WIP,
        ACCOUNT_ROLES.INVENTORY_FINISHED_GOODS,
        ACCOUNT_ROLES.PAYROLL_CLEARING,
        ACCOUNT_ROLES.COGS_PRODUCT_COST,
        ACCOUNT_ROLES.APPLIED_OVERHEAD,
        ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE,
      ].sort()
    )
    expect([...rolesOf('purchasing')].sort()).toEqual(
      [
        ACCOUNT_ROLES.FREIGHT_ACCRUAL,
        ACCOUNT_ROLES.GRNI,
        ACCOUNT_ROLES.DUTIES_ACCRUAL,
        ACCOUNT_ROLES.PPV,
      ].sort()
    )
  })

  // `G12`: count/shrinkage value must land somewhere OTHER than purchase price
  // variance. Different owner, different remedy - so different packs, and the
  // refusal an unmapped role produces names a different pack for each.
  it('keeps 5090 in purchasing and 5095 in inventory', () => {
    expect(codesOf('purchasing')).toContain('5090')
    expect(codesOf('inventory')).toContain('5095')
    expect(byCode.get('5090')?.role).toBe(ACCOUNT_ROLES.PPV)
    expect(byCode.get('5095')?.role).toBe(ACCOUNT_ROLES.INVENTORY_COUNT_VARIANCE)
  })

  // Inbound freight is CAPITALISED into landed cost and accrues to a liability;
  // outbound freight is an expense above gross profit. Two different freights.
  it('does not point the freight accrual role at outbound freight', () => {
    expect(byCode.get('2150')?.role).toBe(ACCOUNT_ROLES.FREIGHT_ACCRUAL)
    expect(byCode.get('5030')?.role).toBeUndefined()
  })

  // `G17`: a customs broker's service charge is landed cost and clears through
  // 2150, not through 2170. Three files used to say otherwise. The account NAME
  // is what a bookkeeper reads, so it is the thing pinned here; the ROLE stays
  // `freight_accrual` on purpose.
  it('names 2150 for brokerage as well as freight', () => {
    expect(byCode.get('2150')?.name).toBe('Inbound Freight & Brokerage Accrual')
    expect(byCode.get('2170')?.name).toBe('Duties Accrual')
  })

  // 1320 WIP is deliberately absent from a RECEIPT posting - nothing in the
  // `partKind` table maps to it. That is a rule about receipts, not about the
  // chart: the L1 month-end inventory entry moves all three inventory accounts.
  it('seeds WIP even though no receipt ever debits it', () => {
    expect(byCode.get('1320')?.role).toBe(ACCOUNT_ROLES.INVENTORY_WIP)
    expect(codesOf('inventory')).toContain('1320')
  })

  // 2110 Payroll Clearing carries assembly labour that CAPITALISES into
  // inventory, which is why it rides with the inventory pack and not the core.
  it('keeps payroll clearing with inventory', () => {
    expect(byCode.get('2110')?.role).toBe(ACCOUNT_ROLES.PAYROLL_CLEARING)
    expect(codesOf('inventory')).toContain('2110')
  })

  // Role-less is the ORDINARY case, not a gap, and it is not a core-only case
  // either: `5010`/`5030` ride with inventory because the P&L groups COGS by
  // subtype, `6105` with the card rail because Affirm's fees clear `1210`
  // (16 §1.6). Pinned so that a future edit that reflexively gives every
  // account a role, or parks every role-less one in the core, has to argue
  // with a test.
  it('leaves role-less accounts in more than one pack', () => {
    const roleless = DEFAULT_CHART_OF_ACCOUNTS.filter((account) => !account.role)
    expect(roleless.map((account) => account.code).sort()).toEqual(
      ['1000', '3000', '5010', '5030', '6105'].sort()
    )
    const packsWithRoleless = new Set(
      CHART_PACK_KEYS.filter((key) => CHART_PACKS[key].accounts.some((a) => !a.role))
    )
    expect(packsWithRoleless.size).toBeGreaterThan(1)
    expect(packsWithRoleless).toContain('core')
    expect(packsWithRoleless).toContain('inventory')
    expect(packsWithRoleless).toContain('card_rail')
  })
})

describe('packForRole', () => {
  it('is total and agrees with the tables', () => {
    for (const role of CODE_ROLE_VALUES) {
      const pack = packForRole(role)
      expect(CHART_PACK_KEYS, role).toContain(pack)
      expect(rolesOf(pack), `${role} -> ${pack}`).toContain(role)
    }
  })
})

describe('requires', () => {
  it('is acyclic and names only declared packs', () => {
    const visit = (key: ChartPackKey, trail: ChartPackKey[]) => {
      expect(trail, `cycle through ${key}`).not.toContain(key)
      for (const required of CHART_PACKS[key].requires ?? []) {
        expect(CHART_PACK_KEYS).toContain(required)
        visit(required, [...trail, key])
      }
    }
    for (const key of CHART_PACK_KEYS) visit(key, [])
  })

  // A receipt debits an inventory role, so a purchasing pack without the
  // inventory pack would refuse on its first receipt.
  it('makes purchasing require inventory, and nothing require the core', () => {
    expect(CHART_PACKS.purchasing.requires).toEqual(['inventory'])
    for (const key of CHART_PACK_KEYS) {
      expect(CHART_PACKS[key].requires ?? []).not.toContain('core')
    }
  })
})

describe('packState', () => {
  const row = (role: string, state: RoleAssignmentRow['state']) => ({ role, state })
  const allAs = (state: RoleAssignmentRow['state']) =>
    CODE_ROLE_VALUES.map((role) => row(role, state))

  it('reads a pack with no unmapped role as provisioned', () => {
    expect(packState('core', allAs('suggested'))).toBe('provisioned')
    expect(packState('core', allAs('confirmed'))).toBe('provisioned')
    // `unused` is a person's answer, not an absence.
    expect(packState('inventory', allAs('unused'))).toBe('provisioned')
  })

  it('reads a pack with every role unmapped as absent, and an empty map as absent', () => {
    expect(packState('purchasing', allAs('unmapped'))).toBe('absent')
    expect(packState('purchasing', [])).toBe('absent')
  })

  it('reads a pack with some roles unmapped as partial', () => {
    const roles = rolesOf('card_rail')
    const map = roles.map((role, i) => row(role, i === 0 ? 'unmapped' : 'suggested'))
    expect(packState('card_rail', map)).toBe('partial')
  })

  it('reads only its own roles', () => {
    const coreMapped = rolesOf('core').map((role) => row(role, 'confirmed'))
    expect(packState('core', coreMapped)).toBe('provisioned')
    expect(packState('card_rail', coreMapped)).toBe('absent')
  })
})
