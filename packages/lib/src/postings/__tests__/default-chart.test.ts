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
// Brief 21 §4.2 then grew the core and added three ROLE-LESS packs (`payroll`,
// `fixed_assets`, `debt`). That flipped the majority of the chart to role-less,
// so the pins about roles say less than they used to and the pins about WHICH
// PACK and WHICH SIDE OF THE BALANCE SHEET carry the weight instead - the two
// mistakes those accounts invite are merging `2120` into `2110` and filing
// `1400` with the customer-side `prepayments` pack.
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

  // The per-pack sizes, so an account cannot be added to a pack without
  // somebody saying which pack. The core grew from 13 to 27 in brief 21 §4.2 -
  // fourteen role-less accounts (prepaid, two owner-equity, eleven operating
  // expenses) - and `payroll`, `fixed_assets` and `debt` arrived in the same
  // pass. The number itself is not the point; being made to state it is.
  it('totals fifty-eight accounts: twenty-seven core, then five, two, nine, four, five, three and three', () => {
    expect(codesOf('core')).toHaveLength(27)
    expect(codesOf('card_rail')).toHaveLength(5)
    expect(codesOf('prepayments')).toHaveLength(2)
    expect(codesOf('inventory')).toHaveLength(9)
    expect(codesOf('purchasing')).toHaveLength(4)
    expect(codesOf('payroll')).toHaveLength(5)
    expect(codesOf('fixed_assets')).toHaveLength(3)
    expect(codesOf('debt')).toHaveLength(3)
    expect(DEFAULT_CHART_OF_ACCOUNTS).toHaveLength(58)
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

  // 16 §1.3's thirteen, plus the fourteen role-less accounts 21 §4.2 added so
  // that a coded bank line, an owner's deposit and a prepaid premium have
  // somewhere to go. Exact list, in code order.
  it('is 16 §1.3s thirteen plus the operating, prepaid and owner accounts of 21 §4.2', () => {
    expect(codesOf('core')).toEqual([
      '1000',
      '1050',
      '1100',
      '1400',
      '2000',
      '2200',
      '3000',
      '3010',
      '3020',
      '3100',
      '3900',
      '4000',
      '4020',
      '4030',
      '4090',
      '6000',
      '6010',
      '6020',
      '6030',
      '6040',
      '6050',
      '6060',
      '6070',
      '6080',
      '6090',
      '6300',
      '6900',
    ])
  })

  // 🛑 `1400` is the company's OWN prepayment - an asset, money we paid a
  // vendor early. The `prepayments` PACK is `2300`/`2350`, money a customer
  // paid US early, which is a liability. Same word, opposite side of the
  // balance sheet; pinned so a later edit cannot tidy the two together.
  it('keeps 1400 Prepaid Expenses an asset in the core, not in the prepayments pack', () => {
    expect(byCode.get('1400')?.accountType).toBe(GlAccountType.ASSET)
    expect(codesOf('core')).toContain('1400')
    expect(codesOf('prepayments')).toEqual(['2300', '2350'])
    for (const code of codesOf('prepayments')) {
      expect(byCode.get(code)?.accountType, code).toBe(GlAccountType.LIABILITY)
    }
  })

  // Owner contributions and draws are CORE, not the `debt` pack: a founder's
  // deposit is a first-week bank line for every company and a loan drawdown is
  // not (21 §4.2). A draw is a return of capital, so it is equity and never an
  // expense - the most common small-company coding error there is.
  it('puts owner contributions and draws in the core, as equity', () => {
    for (const code of ['3010', '3020']) {
      expect(codesOf('core'), code).toContain(code)
      expect(byCode.get(code)?.accountType, code).toBe(GlAccountType.EQUITY)
    }
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
    // And the three packs brief 21 added drive no role at all - they exist so a
    // person has an account to name in a journal, not so a builder does.
    expect(rolesOf('payroll')).toEqual([])
    expect(rolesOf('fixed_assets')).toEqual([])
    expect(rolesOf('debt')).toEqual([])
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
    // Was an exact list of five. Brief 21 §4.2 made role-less the MAJORITY of
    // the chart - thirty of fifty-eight - so listing them all would pin nothing
    // but arithmetic. The five that were arguable when the packs were declared
    // are still pinned by code; the "no new roles" half is the test below.
    for (const code of ['1000', '3000', '5010', '5030', '6105']) {
      expect(byCode.get(code)?.role, code).toBeUndefined()
    }
    const packsWithRoleless = new Set(
      CHART_PACK_KEYS.filter((key) => CHART_PACKS[key].accounts.some((a) => !a.role))
    )
    expect(packsWithRoleless.size).toBeGreaterThan(1)
    expect(packsWithRoleless).toContain('core')
    expect(packsWithRoleless).toContain('inventory')
    expect(packsWithRoleless).toContain('card_rail')
  })

  // 🛑 21 §9. `ACCOUNT_ROLES` is a closed vocabulary tied to builders: a role
  // is what lets a builder name an account without knowing the org's numbering,
  // and no builder emits rent, payroll, depreciation or interest. So every
  // account brief 21 added carries NO role, and one acquiring one by reflex has
  // to argue with this test - it would also have to widen `ACCOUNT_ROLES`,
  // `ROLE_ACCOUNT_TYPES` and `ACCOUNT_ROLE_LABELS` together.
  it('gives no role to a single account brief 21 added', () => {
    const added = [
      '1400',
      '3010',
      '3020',
      '6000',
      '6010',
      '6020',
      '6030',
      '6040',
      '6050',
      '6060',
      '6070',
      '6080',
      '6090',
      '6900',
      ...codesOf('payroll'),
      ...codesOf('fixed_assets'),
      ...codesOf('debt'),
    ]
    for (const code of added) {
      expect(byCode.get(code), code).toBeDefined()
      expect(byCode.get(code)?.role, code).toBeUndefined()
    }
  })

  // 🛑 21 §2.3 and §0.5. `2110 Payroll Clearing` is the manufacturing labour
  // absorption pool and `build-month-end-inventory.ts` only ever CREDITS it;
  // `2120 Net Pay Clearing` holds net pay between the gross-up entry and the
  // bank line. Merging them gives one balance two meanings and no report can
  // separate unabsorbed labour from unpaid net pay again.
  it('keeps the payroll pack clear of 2110, the inventory labour pool', () => {
    expect(codesOf('payroll')).not.toContain('2110')
    expect(codesOf('inventory')).toContain('2110')
    expect(byCode.get('2120')?.name).toBe('Net Pay Clearing')
    expect(byCode.get('2110')?.name).toBe('Payroll Clearing')
  })

  // Accumulated depreciation is a contra-ASSET: it runs credit-normal but it is
  // filed with the assets it reduces, the same reading `4090` gets as a
  // contra-revenue. `GlAccountType` has no contra classification on purpose.
  it('files accumulated depreciation as an asset beside the cost account', () => {
    for (const code of ['1500', '1590']) {
      expect(byCode.get(code)?.accountType, code).toBe(GlAccountType.ASSET)
      expect(byCode.get(code)?.subtype, code).toBe('fixed_asset')
    }
    expect(byCode.get('6500')?.accountType).toBe(GlAccountType.EXPENSE)
    // Not COGS: the P&L puts anything that is not `cost_of_goods_sold` below
    // gross profit, which is where depreciation belongs.
    expect(byCode.get('6500')?.subtype).toBeUndefined()
  })

  // The current / non-current split is what `GlAccountType`'s five-way collapse
  // loses, so the chart carries it as two accounts rather than one.
  it('splits loans payable current from long term, and keeps interest with them', () => {
    expect(codesOf('debt')).toEqual(['2500', '2800', '6600'])
    expect(byCode.get('2500')?.accountType).toBe(GlAccountType.LIABILITY)
    expect(byCode.get('2800')?.accountType).toBe(GlAccountType.LIABILITY)
    expect(byCode.get('6600')?.accountType).toBe(GlAccountType.EXPENSE)
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

  // 🛑 A role-less pack is invisible to the role map, so it reads `absent`
  // however full the map is. `provisioned` would be the expensive answer: the
  // dialog disables a provisioned row, and a pack that carries no role could
  // then never be added at all. Re-walking an idempotent seed costs nothing.
  it('reads a pack with no roles at all as absent, never provisioned', () => {
    for (const pack of ['payroll', 'fixed_assets', 'debt'] as const) {
      expect(rolesOf(pack), pack).toEqual([])
      expect(packState(pack, allAs('confirmed')), pack).toBe('absent')
      expect(packState(pack, []), pack).toBe('absent')
    }
  })

  it('reads only its own roles', () => {
    const coreMapped = rolesOf('core').map((role) => row(role, 'confirmed'))
    expect(packState('core', coreMapped)).toBe('provisioned')
    expect(packState('card_rail', coreMapped)).toBe('absent')
  })
})
