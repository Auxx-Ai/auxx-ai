// packages/lib/src/accounting/connect-and-go/__tests__/bank-account-writes.test.ts

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError } from '../../../errors'
import type { BankAccountPlan } from '../client'

const h = vi.hoisted(() => ({
  plan: { proposals: [], notes: [] } as BankAccountPlan,
  calls: [] as { fn: string; input: Record<string, unknown> }[],
  createError: null as Error | null,
}))

vi.mock('../bank-account-reads', () => ({
  planBankAccountsFromProvider: async () => ok(h.plan),
}))

vi.mock('../../banking/writes', () => ({
  createBankAccount: async (_db: unknown, input: Record<string, unknown>) => {
    h.calls.push({ fn: 'createBankAccount', input })
    return h.createError ? err(h.createError) : ok({ id: `ba_for_${input.glAccountId}` })
  },
  updateBankAccount: async (_db: unknown, input: Record<string, unknown>) => {
    h.calls.push({ fn: 'updateBankAccount', input })
    return ok({ id: input.bankAccountId })
  },
}))

import { applyBankAccountProposals } from '../bank-account-writes'

const db = {} as Database
const base = { organizationId: 'org_1', actorUserId: 'usr_1' }

const PLAN: BankAccountPlan = {
  proposals: [
    {
      key: 'create:gl_sav',
      kind: 'create',
      glAccountId: 'gl_sav',
      glAccountName: 'Savings (9999)',
      providerAccountId: 'p_2',
      name: 'Savings (9999)',
      last4: '9999',
    },
    {
      key: 'link:ba_fc:gl_chk',
      kind: 'link',
      bankAccountId: 'ba_fc',
      bankAccountName: 'Chase',
      last4: '1234',
      glAccountId: 'gl_chk',
      glAccountName: 'Chase Checking (1234)',
      manualBankAccountId: null,
    },
  ],
  notes: [],
}

beforeEach(() => {
  h.plan = PLAN
  h.calls = []
  h.createError = null
})

describe('applyBankAccountProposals', () => {
  it('creates and links only the accepted proposals', async () => {
    const result = await applyBankAccountProposals(db, {
      ...base,
      accept: ['link:ba_fc:gl_chk'],
    })

    expect(result._unsafeUnwrap()).toEqual({
      created: [],
      linked: [{ key: 'link:ba_fc:gl_chk', bankAccountId: 'ba_fc', glAccountId: 'gl_chk' }],
      skipped: [],
      failed: [],
    })
    expect(h.calls).toEqual([
      {
        fn: 'updateBankAccount',
        input: { ...base, bankAccountId: 'ba_fc', glAccountId: 'gl_chk' },
      },
    ])
  })

  it('creates a depository record pointing at the account', async () => {
    const result = await applyBankAccountProposals(db, { ...base, accept: ['create:gl_sav'] })

    expect(result._unsafeUnwrap().created).toEqual([
      { key: 'create:gl_sav', bankAccountId: 'ba_for_gl_sav', glAccountId: 'gl_sav' },
    ])
    expect(h.calls[0]?.input).toEqual({
      ...base,
      name: 'Savings (9999)',
      last4: '9999',
      type: 'depository',
      glAccountId: 'gl_sav',
    })
  })

  it('skips a key the current state no longer proposes, so a repeat is a no-op', async () => {
    h.plan = { proposals: [], notes: [] }
    const result = await applyBankAccountProposals(db, {
      ...base,
      accept: ['create:gl_sav', 'create:gl_sav'],
    })

    expect(result._unsafeUnwrap().skipped).toEqual([
      { key: 'create:gl_sav', reason: 'no_longer_applies' },
    ])
    expect(h.calls).toEqual([])
  })

  it('reports a refused write and carries on', async () => {
    h.createError = new BadRequestError('nope')
    const result = await applyBankAccountProposals(db, {
      ...base,
      accept: ['create:gl_sav', 'link:ba_fc:gl_chk'],
    })

    const report = result._unsafeUnwrap()
    expect(report.failed).toEqual([{ key: 'create:gl_sav', message: 'nope' }])
    expect(report.linked).toHaveLength(1)
  })
})
