// packages/lib/src/accounting/connect-and-go/__tests__/auto-route-rails.test.ts

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError } from '../../../errors'
import type { GatewayHandleCensusRow } from '../../rails/client'

interface FakeAccount {
  id: string
  name: string
  accountType: string
  subtype: string | null
  isActive: boolean
}

const h = vi.hoisted(() => ({
  census: [] as GatewayHandleCensusRow[],
  chart: [] as FakeAccount[],
  gateways: [] as { id: string; clearingGlAccountId: string }[],
  railBanks: [] as string[],
  setUps: [] as Record<string, unknown>[],
  roleWrites: [] as Record<string, unknown>[],
  bankError: null as Error | null,
}))

vi.mock('../../rails/reads', () => ({
  listGatewayHandleCensus: async () => ok(h.census),
  listPaymentGateways: async () => ok(h.gateways),
}))

vi.mock('../../ledger/roles/role-map', () => ({
  listChartAccounts: async () => ok(h.chart),
  listRoleMap: async () =>
    ok([
      {
        role: 'bank',
        railOverrides: h.railBanks.map((paymentGatewayId) => ({ paymentGatewayId })),
      },
    ]),
  setRoleAssignment: async (_db: unknown, input: Record<string, unknown>) => {
    h.roleWrites.push(input)
    return ok({})
  },
}))

// Stateful: a set-up claims its handles, so a second run sees them routed.
vi.mock('../../rails/set-up', () => ({
  setUpPaymentGateway: vi.fn(async (_db: unknown, input: Record<string, unknown>) => {
    h.setUps.push(input)
    const id = `pg_${h.setUps.length}`
    const handles = input.handles as string[]
    for (const row of h.census) if (handles.includes(row.handle)) row.claimedBy = id
    const clearing = input.clearing as { accountId?: string; mint?: string }
    const fee = input.fee as { accountId?: string; mint?: string } | null
    h.gateways.push({ id, clearingGlAccountId: clearing.accountId ?? `minted_${id}` })
    if (input.bankAccountId && !h.bankError) h.railBanks.push(id)
    return ok({
      gateway: {
        id,
        name: input.name,
        clearingGlAccountId: clearing.accountId ?? `minted_${id}`,
        feeGlAccountId: fee ? (fee.accountId ?? `minted_fee_${id}`) : null,
      },
      failures: h.bankError && input.bankAccountId ? [{ step: 'bank', message: 'no bank' }] : [],
    })
  }),
}))

import { autoRouteRails } from '../auto-route-rails'

const db = {} as Database
const base = { organizationId: 'org_1', actorUserId: 'usr_1', today: new Date('2026-09-23') }
const census = (handle: string, over: Partial<GatewayHandleCensusRow> = {}) => ({
  handle,
  claimedBy: null,
  orderCount: 10,
  lastSeenAt: '2026-09-01',
  ...over,
})
const account = (id: string, name: string, over: Partial<FakeAccount> = {}): FakeAccount => ({
  id,
  name,
  accountType: 'asset',
  subtype: null,
  isActive: true,
  ...over,
})
const checking = account('gl_bank', 'Checking', { subtype: 'bank' })

beforeEach(() => {
  h.census = []
  h.chart = []
  h.gateways = []
  h.railBanks = []
  h.setUps = []
  h.roleWrites = []
  h.bankError = null
})

describe('autoRouteRails', () => {
  it('creates one gateway per rail group with the suggested defaults and the one bank', async () => {
    h.census = [census('shopify_payments', { orderCount: 900 }), census('shop_cash')]
    h.chart = [checking]

    const report = (await autoRouteRails(db, base))._unsafeUnwrap()

    expect(h.setUps).toEqual([
      {
        organizationId: 'org_1',
        actorUserId: 'usr_1',
        name: 'Shopify Payments',
        handles: ['shopify_payments', 'shop_cash'],
        feeTreatment: 'netted',
        status: 'active',
        clearing: { mint: 'Shopify Payments Clearing' },
        fee: null,
        bankAccountId: 'gl_bank',
      },
    ])
    expect(report.created).toEqual([expect.objectContaining({ bankAccountId: 'gl_bank' })])
    expect(report.questions).toEqual([])
  })

  it('mints a fee account for a billed rail and closes a stale one', async () => {
    h.census = [census('authorize_net', { lastSeenAt: '2025-01-01' })]
    h.chart = [checking]

    await autoRouteRails(db, base)

    expect(h.setUps[0]).toMatchObject({
      name: 'Authorize.Net',
      feeTreatment: 'billed',
      status: 'closed',
      fee: { mint: 'Authorize.Net Fees' },
    })
  })

  it('asks which bank when there are several, and when there is none', async () => {
    h.census = [census('stripe')]
    h.chart = [checking, account('gl_sav', 'Savings', { subtype: 'bank' })]

    const several = (await autoRouteRails(db, base))._unsafeUnwrap()
    expect(h.setUps[0]?.bankAccountId).toBeNull()
    expect(several.questions).toEqual([
      {
        kind: 'rail_bank',
        gatewayId: 'pg_1',
        name: 'Stripe',
        candidateAccountIds: ['gl_bank', 'gl_sav'],
      },
    ])

    h.census = [census('affirm')]
    h.chart = []
    const none = (await autoRouteRails(db, base))._unsafeUnwrap()
    expect(none.questions).toEqual([expect.objectContaining({ candidateAccountIds: [] })])
  })

  it('is idempotent: a second run creates nothing', async () => {
    h.census = [census('stripe'), census('affirm')]
    h.chart = [checking]

    await autoRouteRails(db, base)
    const second = (await autoRouteRails(db, base))._unsafeUnwrap()

    expect(h.setUps).toHaveLength(2)
    expect(second.created).toEqual([])
    expect(second.banked).toEqual([])
    expect(second.skipped.map((row) => row.reason)).toEqual(['routed', 'routed'])
    expect(second.questions).toEqual([])
  })

  it('gives an existing rail without a bank the single bank account', async () => {
    h.census = [census('stripe', { claimedBy: 'pg_old' })]
    h.chart = [checking]

    const report = (await autoRouteRails(db, base))._unsafeUnwrap()

    expect(h.setUps).toEqual([])
    expect(h.roleWrites).toEqual([
      expect.objectContaining({ role: 'bank', paymentGatewayId: 'pg_old', glAccountId: 'gl_bank' }),
    ])
    expect(report.banked).toEqual([{ gatewayId: 'pg_old', bankAccountId: 'gl_bank' }])
  })

  it('reuses a clearing account a previous run minted under the same name', async () => {
    h.census = [census('stripe')]
    h.chart = [
      checking,
      account('gl_clr', 'Stripe Clearing', { subtype: 'clearing' }),
      account('gl_other', 'Stripe Clearing'),
    ]

    await autoRouteRails(db, base)

    expect(h.setUps[0]?.clearing).toEqual({ accountId: 'gl_clr' })
  })

  it('does not reuse a clearing account another gateway holds', async () => {
    h.census = [census('stripe')]
    h.chart = [checking, account('gl_clr', 'Stripe Clearing', { subtype: 'clearing' })]
    h.gateways = [{ id: 'pg_x', clearingGlAccountId: 'gl_clr' }]

    await autoRouteRails(db, base)

    expect(h.setUps[0]?.clearing).toEqual({ mint: 'Stripe Clearing' })
  })

  it('reports a split rail as a question and leaves it alone', async () => {
    h.census = [census('authorize_net', { claimedBy: 'pg_1' }), census('authorize.net')]
    h.railBanks = ['pg_1']

    const report = (await autoRouteRails(db, base))._unsafeUnwrap()

    expect(h.setUps).toEqual([])
    expect(report.questions).toEqual([
      {
        kind: 'rail_split',
        name: 'Authorize.Net',
        gatewayIds: ['pg_1'],
        unclaimedHandles: ['authorize.net'],
        mergeInto: 'pg_1',
      },
    ])
  })

  it('reports a refused set-up and carries on with the next rail', async () => {
    const { setUpPaymentGateway } = await import('../../rails/set-up')
    vi.mocked(setUpPaymentGateway).mockResolvedValueOnce(err(new BadRequestError('band full')))
    h.census = [census('stripe', { orderCount: 50 }), census('affirm')]
    h.chart = [checking]

    const report = (await autoRouteRails(db, base))._unsafeUnwrap()

    expect(report.failed).toEqual([{ name: 'Stripe', handles: ['stripe'], message: 'band full' }])
    expect(report.created.map((row) => row.name)).toEqual(['Affirm'])
  })
})
