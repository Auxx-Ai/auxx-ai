// packages/lib/src/money/payouts/__tests__/source-reads.test.ts
import type { Database } from '@auxx/database'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ gateways: vi.fn() }))
vi.mock('../../../payment-gateways/reads', () => ({ listPaymentGateways: h.gateways }))

import { loadPayoutSourceSummaries } from '../source-reads'

const account = {
  id: 'account-1',
  providerKey: 'shopify_payments',
  externalAccountId: 'shop-1',
  environment: 'live',
}
const gateway = {
  id: 'gateway-1',
  name: 'Shopify Payments',
  processorAccountId: account.id,
  settlementCurrency: 'USD',
}
const fields = {
  payout_source_provider_key: 'shopify_payments',
  payout_source_account_id: 'shop-1',
  payout_source_environment: 'live',
  payout_source_amount: '1423.01',
  payout_source_currency: 'USD',
  payout_source_currency_exponent: 2,
  payout_source_status: 'paid',
  payout_source_issued_on: '2026-09-15',
}
async function read(
  patch: Record<string, string | number | null | undefined> = {},
  accounts = [account]
) {
  const db = {
    select: () => ({ from: () => ({ where: async () => accounts }) }),
  } as unknown as Database
  const result = await loadPayoutSourceSummaries(db, 'org-1', [
    {
      payoutId: 'pay-1',
      reportedFields: {
        ...fields,
        ...Object.fromEntries(
          Object.entries(patch).filter(
            (entry): entry is [string, string | number | null] => entry[1] !== undefined
          )
        ),
      },
    },
  ])
  return result.get('pay-1')!
}
beforeEach(() => {
  h.gateways.mockResolvedValue(ok([gateway]))
})
describe('settlement source reads', () => {
  it('reads mapped amounts and routes without legacy deposit or gateway fields', async () => {
    expect(await read()).toMatchObject({
      amountMinor: '142301',
      status: 'paid',
      issuedOn: '2026-09-15',
      gatewayId: gateway.id,
      routingIssue: null,
    })
  })
  it.each([
    ['0.00', '0'],
    ['-42.01', '-4201'],
    ['90071992547409.93', '9007199254740993'],
  ])('keeps %s exact', async (amount, expected) => {
    expect((await read({ payout_source_amount: amount })).amountMinor).toBe(expected)
  })
  it.each([
    null,
    'bad',
    '1.001',
  ])('does not turn invalid or missing %s into zero', async (amount) => {
    const result = await read({ payout_source_amount: amount })
    expect(result.amountMinor).toBeNull()
    expect(result.amountIssue).toBeTruthy()
  })
  it.each([
    { payout_source_provider_key: 'stripe' },
    { payout_source_account_id: 'shop-2' },
    { payout_source_environment: 'test' },
    { payout_source_currency: 'CAD' },
  ])('does not route a different identity or currency %j', async (patch) => {
    expect(await read(patch)).toMatchObject({ gatewayId: null, routingIssue: expect.any(String) })
  })
  it('does not pick an arbitrary gateway when settings conflict', async () => {
    h.gateways.mockResolvedValue(ok([gateway, { ...gateway, id: 'gateway-2' }]))
    expect(await read()).toMatchObject({
      gatewayId: null,
      routingIssue: expect.stringContaining('Multiple'),
    })
  })
  it('shows missing account setup without hiding a valid amount', async () => {
    expect(await read({}, [])).toMatchObject({ amountMinor: '142301', gatewayId: null })
  })
  it('does not query routing for legacy records', async () => {
    expect(
      await loadPayoutSourceSummaries({} as Database, 'org-1', [{ payoutId: 'legacy' }])
    ).toEqual(new Map())
    expect(h.gateways).not.toHaveBeenCalled()
  })
})
