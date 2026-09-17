// packages/lib/src/postings/__tests__/clearing-account-per-rail.test.ts
//
// plans/accounting/tasks/58-one-mapping-table.md goal 1 and acceptance §9
// item 2, carried over from brief 26 §12.
//
// Every other test in this directory checks one builder. This file checks the
// one thing no single builder can: that the DEBIT a fulfillment writes and the
// CREDIT a payout writes for one rail meet on the SAME account.
//
// 🛑 Why that still needs its own file after task 58. The drift brief 26 feared
// - two builders each computing a clearing account id - is gone, because both
// sides now emit a ROLE and a rail scope and `resolveRoles` answers once. What
// replaced it is narrower and just as silent: the two sides must name the SAME
// RAIL, on the same axis, or they resolve through different rows of one table
// and the rail never reaches zero. Both entries still balance. Nothing
// downstream compares them. A test that exercises one side at a time cannot
// see it - which is why the one-sided coverage in
// `build-fulfillment-batch-entry.test.ts` is not a substitute.

import { describe, expect, it } from 'vitest'
import { ACCOUNT_ROLES } from '../build-entry'
import {
  type FulfillmentGatewayRoute,
  resolveFulfillmentDebit,
} from '../build-fulfillment-batch-entry'
import { buildPayoutEntry } from '../build-payout-entry'

/** The gateway record under test: one rail, two spellings. */
const AUTHORIZE_NET: FulfillmentGatewayRoute = {
  id: 'gateway_authorize_net',
  name: 'Authorize.net',
  handles: ['authorize_net', 'authorize.net'],
  active: true,
}

const PAYOUT = {
  payoutId: 'po_authnet_1',
  payoutNumber: 'PO-0009',
  rail: AUTHORIZE_NET.id,
  currency: 'USD',
  grossMinor: 500_000,
  feesMinor: 14_800,
  netMinor: 485_200,
  paidAt: '2026-09-04',
}

/** The rail the shipment's clearing debit names, or null when no record claims the handle. */
function shipmentRail(gateway: string): string | null {
  const debit = resolveFulfillmentDebit({
    financialStatus: 'paid',
    gateways: [gateway],
    gatewayRoutes: [AUTHORIZE_NET],
  })
  if (debit.kind !== 'debit' || debit.role !== ACCOUNT_ROLES.CLEARING)
    throw new Error(`expected a clearing debit, got ${JSON.stringify(debit)}`)
  return debit.rail ?? null
}

/** The rail the payout's clearing credit names. */
function payoutRail() {
  const credit = buildPayoutEntry(PAYOUT).entry.lines.find(
    (row) => row.accountRole === ACCOUNT_ROLES.CLEARING
  )
  expect(credit).toMatchObject({ direction: 'credit' })
  return credit?.sourceScope?.rail ?? null
}

describe('a rail reconciles to zero on its own', () => {
  it('debits and credits the same rail, so both resolve through one row', () => {
    expect(shipmentRail('authorize_net')).toBe(payoutRail())
  })

  it('holds for the rail-s other spelling - a handle list is not an identity', () => {
    expect(shipmentRail('authorize.net')).toBe(payoutRail())
  })

  it('names the gateway RECORD on both sides, never an account or a handle', () => {
    expect(payoutRail()).toBe(AUTHORIZE_NET.id)
    expect(shipmentRail('authorize_net')).toBe(AUTHORIZE_NET.id)
  })

  it('falls to the org default on both sides when no record claims the handle', () => {
    // 🛑 `null` must mean the unscoped row to the fulfillment side too, or a
    // handle nobody claims debits the default and its payout credits a rail.
    const debit = resolveFulfillmentDebit({
      financialStatus: 'paid',
      gateways: ['some_unmapped_rail'],
      gatewayRoutes: [AUTHORIZE_NET],
    })
    if (debit.kind !== 'debit') throw new Error(`expected a debit, got ${JSON.stringify(debit)}`)
    expect(debit).toMatchObject({ role: ACCOUNT_ROLES.CLEARING, rail: null })
  })
})
