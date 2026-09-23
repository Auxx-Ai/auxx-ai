// packages/lib/src/accounting/rails/__tests__/set-up.test.ts

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError, UnprocessableEntityError } from '../../../errors'

const h = vi.hoisted(() => ({
  calls: [] as { fn: string; input: Record<string, unknown> }[],
  mintError: null as Error | null,
  createError: null as Error | null,
  bankError: null as Error | null,
  feedError: null as Error | null,
}))

vi.mock('../mint-rail-accounts', () => ({
  mintRailAccounts: async (_db: unknown, input: Record<string, unknown>) => {
    h.calls.push({ fn: 'mintRailAccounts', input })
    if (h.mintError) return err(h.mintError)
    return ok({
      clearing: { id: 'acct_clearing' },
      fee: input.mintFeeAccount ? { id: 'acct_fee' } : null,
    })
  },
  mintRailFeeAccount: async (_db: unknown, input: Record<string, unknown>) => {
    h.calls.push({ fn: 'mintRailFeeAccount', input })
    return ok({ id: 'acct_fee_only' })
  },
}))

vi.mock('../writes', () => ({
  createPaymentGateway: async (_db: unknown, input: Record<string, unknown>) => {
    h.calls.push({ fn: 'createPaymentGateway', input })
    if (h.createError) return err(h.createError)
    return ok({ id: 'pg_new', name: input.name, handles: input.handles })
  },
}))

vi.mock('../../ledger/roles/role-map', () => ({
  setRoleAssignment: async (_db: unknown, input: Record<string, unknown>) => {
    h.calls.push({ fn: 'setRoleAssignment', input })
    return h.bankError ? err(h.bankError) : ok({ role: input.role })
  },
}))

vi.mock('../feeds', () => ({
  linkFeed: async (_db: unknown, input: Record<string, unknown>) => {
    h.calls.push({ fn: 'linkFeed', input })
    return h.feedError ? err(h.feedError) : ok({ sourceAccountId: input.sourceAccountId })
  },
}))

import { setUpPaymentGateway } from '../set-up'

const db = {} as Database
const base = {
  organizationId: 'org_1',
  actorUserId: 'usr_1',
  name: 'Authorize.Net',
  handles: ['authorize.net'],
}
const fn = (name: string) => h.calls.filter((call) => call.fn === name)

beforeEach(() => {
  h.calls = []
  h.mintError = h.createError = h.bankError = h.feedError = null
})

describe('setUpPaymentGateway', () => {
  it('mints the clearing account, inherits fees, maps the bank and links the feed', async () => {
    const result = await setUpPaymentGateway(db, {
      ...base,
      clearing: { mint: 'Authorize.Net Clearing' },
      fee: null,
      bankAccountId: 'acct_bank',
      sourceAccountId: 'fsa_1',
    })

    expect(result._unsafeUnwrap()).toEqual({
      gateway: expect.objectContaining({ id: 'pg_new' }),
      failures: [],
    })
    expect(fn('mintRailAccounts')[0]!.input).toMatchObject({
      clearingAccountName: 'Authorize.Net Clearing',
      mintFeeAccount: false,
    })
    expect(fn('createPaymentGateway')[0]!.input).toMatchObject({
      clearingAccountId: 'acct_clearing',
      feeAccountId: null,
    })
    expect(fn('setRoleAssignment')[0]!.input).toMatchObject({
      role: 'bank',
      paymentGatewayId: 'pg_new',
      glAccountId: 'acct_bank',
    })
    expect(fn('linkFeed')[0]!.input).toMatchObject({
      gatewayId: 'pg_new',
      sourceAccountId: 'fsa_1',
    })
  })

  it('mints only the fee account beside an existing clearing account', async () => {
    await setUpPaymentGateway(db, {
      ...base,
      clearing: { accountId: 'acct_1200' },
      fee: { mint: 'Authorize.Net Fees' },
    })

    expect(fn('mintRailAccounts')).toHaveLength(0)
    expect(fn('createPaymentGateway')[0]!.input).toMatchObject({
      clearingAccountId: 'acct_1200',
      feeAccountId: 'acct_fee_only',
    })
  })

  it('returns the gateway with the failed step when the bank refuses after create', async () => {
    h.bankError = new UnprocessableEntityError('Cannot map bank to 1200')

    const result = await setUpPaymentGateway(db, {
      ...base,
      clearing: { accountId: 'acct_1200' },
      bankAccountId: 'acct_1200',
      sourceAccountId: 'fsa_1',
    })

    expect(result._unsafeUnwrap()).toEqual({
      gateway: expect.objectContaining({ id: 'pg_new' }),
      failures: [{ step: 'bank', message: 'Cannot map bank to 1200' }],
    })
    // The feed still links; one failed step does not stop the next.
    expect(fn('linkFeed')).toHaveLength(1)
  })

  it('refuses without writing the gateway when the mint refuses', async () => {
    h.mintError = new BadRequestError('The clearing account needs a name.')

    const result = await setUpPaymentGateway(db, { ...base, clearing: { mint: ' ' } })

    expect(result._unsafeUnwrapErr()).toBe(h.mintError)
    expect(fn('createPaymentGateway')).toHaveLength(0)
  })

  it('refuses and maps nothing when the gateway create refuses', async () => {
    h.createError = new BadRequestError('Handle authorize.net is already routed')

    const result = await setUpPaymentGateway(db, {
      ...base,
      clearing: { accountId: 'acct_1200' },
      bankAccountId: 'acct_bank',
    })

    expect(result._unsafeUnwrapErr()).toBe(h.createError)
    expect(fn('setRoleAssignment')).toHaveLength(0)
  })
})
