// apps/web/src/components/accounting/ui/settings/__tests__/payment-gateway-add-dialog.test.ts

import type { PaymentGatewayRow } from '@auxx/lib/accounting/rails/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('~/trpc/react', () => ({ api: {} }))

import { MINT_ACCOUNT_VALUE } from '../mapping-account-select'
import { draftFor, findSiblingGateway } from '../payment-gateway-add-dialog'
import { railReadinessLine } from '../payment-gateway-rail-rows'

function gateway(overrides: Partial<PaymentGatewayRow>): PaymentGatewayRow {
  return {
    id: 'pg_1',
    name: 'Authorize.Net',
    handles: ['authorize_net'],
    status: 'active',
    ...overrides,
  } as PaymentGatewayRow
}

describe('draftFor', () => {
  it('seeds a Blocked row handle as seen, with the catalogue name and treatment', () => {
    const draft = draftFor('authorize.net')
    expect(draft.handles).toEqual(['authorize.net'])
    expect(draft.name).toBe('Authorize.Net')
    // Billed in the catalogue, so its fees get an account of their own by default.
    expect(draft.feeTreatment).toBe('billed')
    expect(draft.accounts).toEqual({
      clearing: MINT_ACCOUNT_VALUE,
      payment_processing_fees: MINT_ACCOUNT_VALUE,
      bank: null,
    })
  })

  it('keeps the raw spelling of a handle and inherits fees on a netted rail', () => {
    const draft = draftFor('Affirm')
    expect(draft.handles).toEqual(['Affirm'])
    expect(draft.accounts.payment_processing_fees).toBe('inherit')
  })

  it('starts blank without a handle', () => {
    const draft = draftFor()
    expect(draft.handles).toEqual([])
    expect(draft.name).toBe('')
  })
})

describe('findSiblingGateway', () => {
  it('finds the gateway routing another catalogue spelling of the same rail', () => {
    const existing = gateway({})
    expect(findSiblingGateway('authorize.net', [existing])).toBe(existing)
  })

  it('ignores a gateway that already routes this handle', () => {
    expect(
      findSiblingGateway('authorize.net', [gateway({ handles: ['Authorize.net'] })])
    ).toBeNull()
  })

  it('ignores closed gateways and unknown handles', () => {
    expect(findSiblingGateway('authorize.net', [gateway({ status: 'closed' })])).toBeNull()
    expect(findSiblingGateway('my_gateway', [gateway({ handles: ['my-gateway'] })])).toBeNull()
  })
})

describe('railReadinessLine', () => {
  it('needs a clearing account first, then a bank once a feed is linked', () => {
    expect(
      railReadinessLine({ clearingMapped: false, bankMapped: false, feedLinked: false }).ready
    ).toBe(false)
    expect(
      railReadinessLine({ clearingMapped: true, bankMapped: false, feedLinked: true })
    ).toEqual({
      ready: false,
      text: 'Needs a receiving bank account for its feed.',
    })
    expect(
      railReadinessLine({ clearingMapped: true, bankMapped: false, feedLinked: false }).ready
    ).toBe(true)
  })
})
