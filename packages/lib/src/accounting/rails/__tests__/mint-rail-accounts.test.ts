// packages/lib/src/accounting/rails/__tests__/mint-rail-accounts.test.ts
//
// The mint door (brief 26 §7).
//
// 🛑 The property this file exists for is a NEGATIVE one: a minted account
// carries no role, and there is no parameter that could give it one. That is
// the rule that killed `clearing_affirm` on 2026-09-10 - "a role must not name
// a vendor" - and a regression would be invisible, since an entry posted
// through a rogue role still balances. The test below reads what was actually
// handed to `createChartAccount` and asserts the key is absent.
//
// The collaborators are stubbed at the module boundary rather than at the
// database: `listChartAccounts` and `createChartAccount` are both already
// covered by their own suites (`role-map.test.ts`, `chart-write.test.ts`), and
// re-stubbing three tables here would test those two again instead of the
// arithmetic between them.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, UnprocessableEntityError } from '../../../errors'
import type { ChartAccountRow } from '../../ledger/types'

const h = vi.hoisted(() => ({
  /** The chart `listChartAccounts` answers with. */
  chart: [] as { code: string | null }[],
  /** Every `createChartAccount` call, in order. */
  creates: [] as Record<string, unknown>[],
  /** Set to make the Nth create fail. */
  createError: null as { index: number; error: Error } | null,
}))

vi.mock('../../ledger/roles/role-map', () => ({
  listChartAccounts: async () => {
    const { ok } = await import('neverthrow')
    return ok(h.chart)
  },
}))

vi.mock('../../ledger/chart/chart-write', () => ({
  createChartAccount: async (_db: unknown, options: Record<string, unknown>) => {
    const { err, ok } = await import('neverthrow')
    const index = h.creates.length
    h.creates.push(options)
    if (h.createError?.index === index) return err(h.createError.error)
    return ok({
      id: `acct_${index}`,
      code: options.code ?? null,
      name: options.name,
      accountType: options.accountType,
      subtype: options.subtype ?? null,
      isActive: true,
    } as ChartAccountRow)
  },
}))

import { mintRailAccounts } from '../mint-rail-accounts'

const db = {} as Database
const ORG = 'org_1'
const USER = 'usr_bookkeeper'

/** A chart of nothing but codes - all the allocator reads. */
function chart(...codes: (string | null)[]) {
  return codes.map((code) => ({ code }))
}

function mint(overrides: Partial<Parameters<typeof mintRailAccounts>[1]> = {}) {
  return mintRailAccounts(db, {
    organizationId: ORG,
    actorUserId: USER,
    clearingAccountName: 'Shopify Payments Clearing',
    mintFeeAccount: false,
    ...overrides,
  })
}

beforeEach(() => {
  h.chart = chart('1000', '1100', '1200', '6100')
  h.creates = []
  h.createError = null
})

describe('mintRailAccounts', () => {
  it('mints a clearing account with the first free code in the band', async () => {
    const result = await mint()

    expect(result.isOk()).toBe(true)
    expect(h.creates).toHaveLength(1)
    expect(h.creates[0]).toMatchObject({
      organizationId: ORG,
      actorUserId: USER,
      code: '1201',
      name: 'Shopify Payments Clearing',
      accountType: 'asset',
      subtype: 'clearing',
    })
    expect(result._unsafeUnwrap().fee).toBeNull()
  })

  it('🛑 never passes a role, on either account', async () => {
    await mint({ mintFeeAccount: true, feeAccountName: 'Authorize.Net Fees' })

    expect(h.creates).toHaveLength(2)
    for (const call of h.creates) {
      expect(call).not.toHaveProperty('role')
      expect(Object.keys(call)).not.toContain('role')
    }
  })

  it('mints the fee account into the fee band, as an expense', async () => {
    const result = await mint({ mintFeeAccount: true, feeAccountName: 'Authorize.Net Fees' })

    expect(h.creates[1]).toMatchObject({
      code: '6101',
      name: 'Authorize.Net Fees',
      accountType: 'expense',
    })
    expect(result._unsafeUnwrap().fee?.id).toBe('acct_1')
  })

  it('mints a null code on a chart that carries none (§7.1)', async () => {
    h.chart = chart(null, null, null)

    const result = await mint({ mintFeeAccount: true, feeAccountName: 'Fees' })

    expect(result.isOk()).toBe(true)
    expect(h.creates[0]?.code).toBeNull()
    expect(h.creates[1]?.code).toBeNull()
  })

  it('trims the names it is given', async () => {
    await mint({ clearingAccountName: '  Affirm Clearing  ' })

    expect(h.creates[0]?.name).toBe('Affirm Clearing')
  })

  it('refuses a blank clearing account name before writing anything', async () => {
    const result = await mint({ clearingAccountName: '   ' })

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(h.creates).toHaveLength(0)
  })

  it('refuses a fee account with no name before writing anything', async () => {
    const result = await mint({ mintFeeAccount: true })

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(h.creates).toHaveLength(0)
  })

  it('refuses a full band before writing anything, not halfway through', async () => {
    // Both codes are allocated up front, so a full FEE band stops the CLEARING
    // account from being written at all.
    h.chart = chart('1200', ...Array.from({ length: 50 }, (_, index) => String(6100 + index)))

    const result = await mint({ mintFeeAccount: true, feeAccountName: 'Fees' })

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(UnprocessableEntityError)
    expect(h.creates).toHaveLength(0)
  })

  it('surfaces the chart write refusal verbatim', async () => {
    const refusal = new UnprocessableEntityError('nope')
    h.createError = { index: 0, error: refusal }

    const result = await mint()

    expect(result._unsafeUnwrapErr()).toBe(refusal)
  })
})
