// packages/lib/src/postings/__tests__/chart-import.test.ts
//
// `chart-import.ts` is the WRITER half; everything it reads or writes through a
// collaborator is stubbed the way `chart-write.test.ts` and
// `account-identities.test.ts` stub theirs - an `AccountingProvider` double for
// the provider seam, `../role-map` and `../chart-write` mocked at the module
// boundary, and a hand-written `db` for the one raw write this file makes
// itself: the `GlRoleAssignment` insert. `chart-import-plan.ts` is NOT mocked -
// the real planner runs, so these tests exercise the actual ordering and
// idempotency the writer promises on top of it.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const listChartAccounts = vi.fn()
const listRoleMap = vi.fn()
vi.mock('../role-map', () => ({
  listChartAccounts: (...a: unknown[]) => listChartAccounts(...a),
  listRoleMap: (...a: unknown[]) => listRoleMap(...a),
}))

const createChartAccountMock = vi.fn()
vi.mock('../chart-write', () => ({
  createChartAccount: (...a: unknown[]) => createChartAccountMock(...a),
}))

const resolveAccountingProvider = vi.fn()
vi.mock('../provider', () => ({
  resolveAccountingProvider: (...a: unknown[]) => resolveAccountingProvider(...a),
  NONE_PROVIDER_ID: 'none',
}))

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import { UniqueValueConflictError, UnprocessableEntityError } from '../../errors'
import { importChartFromProvider } from '../chart-import'
import type { ChartAccountRow, ProviderAccount, RoleAssignmentRow } from '../types'

const ORG = 'org1'
const USER = 'user1'

function providerAccount(over: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: 'p1',
    name: 'Checking',
    fullyQualifiedName: 'Checking',
    number: null,
    accountType: 'Bank',
    classification: 'asset',
    active: true,
    ...over,
  }
}

/** Every declared role this module cares about, `unmapped` unless overridden. */
function roleMapRows(
  overrides: Record<string, RoleAssignmentRow['state']> = {}
): RoleAssignmentRow[] {
  const roles = [
    'accounts_receivable',
    'accounts_payable',
    'undeposited_funds',
    'sales_tax_payable',
    'equity_retained_earnings',
    'equity_opening_balance',
    'bad_debt_expense',
    'revenue_product',
    'revenue_shipping',
    'revenue_service',
    'revenue_returns_allowances',
  ]
  return roles.map((role) => ({
    role,
    state: overrides[role] ?? 'unmapped',
    accountId: null,
    account: null,
    source: null,
    confirmedAt: null,
  }))
}

/** A provider whose relevant methods answer from the arguments given. */
function stubProvider(
  options: { id?: string; accounts?: ProviderAccount[]; mappings?: Map<string, string> } = {}
) {
  const setAccountMapping = vi.fn<() => Promise<Result<void, Error>>>(async () => ok(undefined))
  const provider = {
    id: options.id ?? 'stub',
    listProviderAccounts: async () => ok(options.accounts ?? []),
    listAccountMappings: async () => ok(options.mappings ?? new Map<string, string>()),
    setAccountMapping,
  }
  resolveAccountingProvider.mockResolvedValue(provider)
  return { setAccountMapping }
}

/** A `db` whose only real job is the `GlRoleAssignment` insert this module makes itself. */
function stubDb(alreadyAssigned: Set<string> = new Set()) {
  const insertedRows: {
    organizationId: string
    role: string
    glAccountId: string
    source: string
  }[] = []
  const db = {
    insert: () => ({
      values: (row: {
        organizationId: string
        role: string
        glAccountId: string
        source: string
      }) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            const key = `${row.organizationId}:${row.role}`
            if (alreadyAssigned.has(key)) return []
            alreadyAssigned.add(key)
            insertedRows.push(row)
            return [{ id: `assignment_${row.role}` }]
          },
        }),
      }),
    }),
  } as unknown as Database
  return { db, insertedRows }
}

let callLog: string[]

beforeEach(() => {
  vi.clearAllMocks()
  callLog = []
  createChartAccountMock.mockImplementation(
    async (_db: Database, opts: Record<string, unknown>) => {
      const name = opts.name as string
      callLog.push(`create:${name}:${opts.code ?? 'null'}`)
      return ok({
        id: `gl_${name.replace(/\s+/g, '_').toLowerCase()}`,
        code: (opts.code as string | null) ?? null,
        name,
        accountType: opts.accountType,
        subtype: (opts.subtype as string | null) ?? null,
        isActive: true,
      } as ChartAccountRow)
    }
  )
  listChartAccounts.mockResolvedValue(ok<ChartAccountRow[]>([]))
})

describe('nothing connected', () => {
  it('refuses with UnprocessableEntityError rather than reporting an empty success', async () => {
    stubProvider({ id: 'none', accounts: [] })
    listRoleMap.mockResolvedValue(ok(roleMapRows()))
    const { db } = stubDb()

    const result = await importChartFromProvider(db, { organizationId: ORG, actorUserId: USER })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
  })
})

describe('a normal import', () => {
  it('creates in provider order, sets each identity right after its create, and assigns unmapped roles as import', async () => {
    const ar = providerAccount({
      id: 'p_ar',
      name: 'Accounts Receivable',
      accountType: 'Accounts Receivable',
      classification: 'asset',
    })
    const other = providerAccount({ id: 'p_other', name: 'Checking', accountType: 'Bank' })
    const { setAccountMapping } = stubProvider({ accounts: [other, ar] })
    listRoleMap.mockResolvedValue(ok(roleMapRows()))
    const { db, insertedRows } = stubDb()

    const result = await importChartFromProvider(db, { organizationId: ORG, actorUserId: USER })

    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value.created).toBe(2)
    expect(value.alreadyImported).toBe(0)
    expect(value.skippedInactive).toBe(0)
    expect(value.rolesAssigned).toEqual(['accounts_receivable'])

    // Created in provider order, and each identity set right after its own create -
    // the missing-core creates (asserted below via `coreCreated`) land after both.
    expect(callLog.slice(0, 2)).toEqual(['create:Checking:null', 'create:Accounts Receivable:null'])
    expect(setAccountMapping).toHaveBeenNthCalledWith(1, {
      orgId: ORG,
      glAccountId: 'gl_checking',
      providerAccountId: 'p_other',
      actorUserId: USER,
    })
    expect(setAccountMapping).toHaveBeenNthCalledWith(2, {
      orgId: ORG,
      glAccountId: 'gl_accounts_receivable',
      providerAccountId: 'p_ar',
      actorUserId: USER,
    })

    // The import-assigned role.
    expect(insertedRows).toContainEqual({
      organizationId: ORG,
      role: 'accounts_receivable',
      glAccountId: 'gl_accounts_receivable',
      source: 'import',
    })

    // Every other core role-bearing account with no candidate was created,
    // uncoded, with no identity - `setAccountMapping` was never called for them.
    const coreOnlyCalls = value.coreCreated.map((a) => a.role)
    expect(coreOnlyCalls).not.toContain('accounts_receivable')
    expect(coreOnlyCalls.length).toBeGreaterThan(0)
    for (const account of value.coreCreated) {
      expect(insertedRows).toContainEqual(
        expect.objectContaining({ role: account.role, source: 'seed' })
      )
    }
    expect(setAccountMapping).toHaveBeenCalledTimes(2)
  })

  it('never touches a role that is already mapped', async () => {
    const ar = providerAccount({
      id: 'p_ar',
      name: 'Accounts Receivable',
      accountType: 'Accounts Receivable',
      classification: 'asset',
    })
    stubProvider({ accounts: [ar] })
    listRoleMap.mockResolvedValue(ok(roleMapRows({ accounts_receivable: 'confirmed' })))
    const { db, insertedRows } = stubDb()

    const result = await importChartFromProvider(db, { organizationId: ORG, actorUserId: USER })

    expect(result._unsafeUnwrap().rolesAssigned).toEqual([])
    expect(insertedRows.some((row) => row.role === 'accounts_receivable')).toBe(false)
  })
})

describe('a code collision', () => {
  it('creates the account without a code, logs it, and completes the run', async () => {
    createChartAccountMock.mockImplementation(
      async (_db: Database, opts: Record<string, unknown>) => {
        const name = opts.name as string
        const code = opts.code as string | null
        callLog.push(`create:${name}:${code ?? 'null'}`)
        if (code) {
          return err(
            new UniqueValueConflictError({
              message: `${code} is already in use.`,
              conflictingValue: code,
              fieldId: 'fld_code',
            })
          )
        }
        return ok({
          id: `gl_${name.replace(/\s+/g, '_').toLowerCase()}`,
          code: null,
          name,
          accountType: opts.accountType,
          subtype: (opts.subtype as string | null) ?? null,
          isActive: true,
        } as ChartAccountRow)
      }
    )

    const account = providerAccount({ id: 'p1', number: '1000', name: 'Cash Overseas' })
    const { setAccountMapping } = stubProvider({ accounts: [account] })
    listRoleMap.mockResolvedValue(ok(roleMapRows()))
    const { db } = stubDb()

    const result = await importChartFromProvider(db, { organizationId: ORG, actorUserId: USER })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().created).toBe(1)
    expect(callLog.slice(0, 2)).toEqual(['create:Cash Overseas:1000', 'create:Cash Overseas:null'])
    expect(setAccountMapping).toHaveBeenCalledWith(
      expect.objectContaining({ glAccountId: 'gl_cash_overseas', providerAccountId: 'p1' })
    )
  })
})

describe('refreshOnly', () => {
  it('never creates the missing core', async () => {
    const ar = providerAccount({
      id: 'p_ar',
      name: 'Accounts Receivable',
      accountType: 'Accounts Receivable',
      classification: 'asset',
    })
    stubProvider({ accounts: [ar] })
    listRoleMap.mockResolvedValue(ok(roleMapRows()))
    const { db } = stubDb()

    const result = await importChartFromProvider(db, {
      organizationId: ORG,
      actorUserId: USER,
      refreshOnly: true,
    })

    expect(result.isOk()).toBe(true)
    const value = result._unsafeUnwrap()
    expect(value.coreCreated).toEqual([])
    // Only the one provider account was created - no core accounts.
    expect(value.created).toBe(1)
    expect(value.rolesAssigned).toEqual(['accounts_receivable'])
  })
})
