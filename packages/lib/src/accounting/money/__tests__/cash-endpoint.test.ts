// packages/lib/src/accounting/money/__tests__/cash-endpoint.test.ts
//
// One resolver, four shapes: a rail's clearing scoped by rail and currency, a
// bank account's own pointer, the unscoped undeposited funds role, or a gift card's
// liability. Each returns the role it resolved (101 E8).

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resolveRoles: vi.fn(),
  resolveBankAccountGlAccountInTx: vi.fn(),
}))

vi.mock('../../ledger/roles/resolve-roles', () => ({ resolveRoles: h.resolveRoles }))
vi.mock('../../ledger/chart/resolve-cash-account', () => ({
  resolveBankAccountGlAccountInTx: h.resolveBankAccountGlAccountInTx,
}))

import type { Transaction } from '@auxx/database'
import { UnprocessableEntityError } from '../../../errors'
import { refusalFromError } from '../../work-items/refusal'
import { resolveCashEndpoint } from '../cash-endpoint'
import { validateCashEndpointSource } from '../client'

const ORG = 'org_1'
const tx = {} as Transaction

beforeEach(() => {
  vi.clearAllMocks()
  h.resolveRoles.mockResolvedValue(ok(new Map([['clearing', { glAccountId: 'gl_clearing' }]])))
  h.resolveBankAccountGlAccountInTx.mockResolvedValue('gl_bank')
})

describe('resolveCashEndpoint', () => {
  it('resolves a rail through the clearing role scoped by rail and currency', async () => {
    const endpoint = await resolveCashEndpoint(
      tx,
      ORG,
      { paymentGatewayId: 'pg_1', cashAccountInstanceId: null, currency: 'USD' },
      'Invoice receipt'
    )
    expect(endpoint).toEqual({
      glAccountId: 'gl_clearing',
      kind: 'clearing',
      role: 'clearing',
      railId: 'pg_1',
    })
    expect(h.resolveRoles).toHaveBeenCalledWith(tx, ORG, ['clearing'], {
      rail: 'pg_1',
      currency: 'USD',
    })
  })

  it('resolves a bank account through its own GL pointer', async () => {
    const endpoint = await resolveCashEndpoint(
      tx,
      ORG,
      { paymentGatewayId: null, cashAccountInstanceId: 'ba_1', currency: 'USD' },
      'Refund'
    )
    expect(endpoint).toEqual({
      glAccountId: 'gl_bank',
      kind: 'bank_account',
      role: 'bank',
      railId: null,
    })
    expect(h.resolveBankAccountGlAccountInTx).toHaveBeenCalledWith(tx, ORG, 'ba_1', 'Refund')
    expect(h.resolveRoles).not.toHaveBeenCalled()
  })

  it('resolves neither to the unscoped undeposited funds role', async () => {
    h.resolveRoles.mockResolvedValue(
      ok(new Map([['undeposited_funds', { glAccountId: 'gl_undep' }]]))
    )
    const endpoint = await resolveCashEndpoint(
      tx,
      ORG,
      { paymentGatewayId: null, cashAccountInstanceId: null, currency: 'USD' },
      'Invoice receipt'
    )
    expect(endpoint).toEqual({
      glAccountId: 'gl_undep',
      kind: 'undeposited_funds',
      role: 'undeposited_funds',
      railId: null,
    })
    expect(h.resolveRoles).toHaveBeenCalledWith(tx, ORG, ['undeposited_funds'])
  })

  it('resolves a gift card payment to the unscoped liability, never the rail', async () => {
    h.resolveRoles.mockResolvedValue(
      ok(new Map([['gift_card_liability', { glAccountId: 'gl_gift' }]]))
    )
    const endpoint = await resolveCashEndpoint(
      tx,
      ORG,
      { paymentGatewayId: null, cashAccountInstanceId: null, currency: 'USD', giftCard: true },
      'Customer payment'
    )
    expect(endpoint).toEqual({
      glAccountId: 'gl_gift',
      kind: 'gift_card',
      role: 'gift_card_liability',
      railId: null,
    })
    expect(h.resolveRoles).toHaveBeenCalledWith(tx, ORG, ['gift_card_liability'])
  })

  it('names an unmapped gift card liability ROLE_UNMAPPED', async () => {
    h.resolveRoles.mockResolvedValue(ok(new Map()))
    const error = await resolveCashEndpoint(
      tx,
      ORG,
      { paymentGatewayId: null, cashAccountInstanceId: null, currency: 'USD', giftCard: true },
      'Customer payment'
    ).catch((e: unknown) => e)
    expect(refusalFromError(error as UnprocessableEntityError)).toMatchObject({
      reasonCode: 'ROLE_UNMAPPED',
      role: 'gift_card_liability',
    })
  })

  it('refuses a movement that names both a rail and a bank account', async () => {
    await expect(
      resolveCashEndpoint(
        tx,
        ORG,
        { paymentGatewayId: 'pg_1', cashAccountInstanceId: 'ba_1', currency: 'USD' },
        'Vendor payment'
      )
    ).rejects.toBeInstanceOf(UnprocessableEntityError)
  })

  it('names the subject when a rail is unmapped', async () => {
    h.resolveRoles.mockResolvedValue(err(new Error('Role clearing is not mapped')))
    await expect(
      resolveCashEndpoint(
        tx,
        ORG,
        { paymentGatewayId: 'pg_1', cashAccountInstanceId: null, currency: 'USD' },
        'Vendor payment'
      )
    ).rejects.toThrow(/^Vendor payment: Role clearing is not mapped$/)
  })

  it('names the subject when undeposited funds is unmapped', async () => {
    h.resolveRoles.mockResolvedValue(ok(new Map()))
    await expect(
      resolveCashEndpoint(
        tx,
        ORG,
        { paymentGatewayId: null, cashAccountInstanceId: null, currency: 'USD' },
        'Refund'
      )
    ).rejects.toThrow('Refund undeposited funds account is not mapped')
  })

  it('names the subject when a bank account is unmapped', async () => {
    h.resolveBankAccountGlAccountInTx.mockRejectedValue(
      new UnprocessableEntityError('Refund bank account is missing or archived')
    )
    await expect(
      resolveCashEndpoint(
        tx,
        ORG,
        { paymentGatewayId: null, cashAccountInstanceId: 'ba_1', currency: 'USD' },
        'Refund'
      )
    ).rejects.toThrow('Refund bank account is missing or archived')
  })
})

describe('the code a cash endpoint refusal carries', () => {
  const refusal = (source: Parameters<typeof resolveCashEndpoint>[2]) =>
    resolveCashEndpoint(tx, ORG, source, 'Refund').catch((error: unknown) =>
      refusalFromError(error)
    )

  it('names an unmapped clearing or undeposited funds ROLE_UNMAPPED, so mapping it wakes', async () => {
    h.resolveRoles.mockResolvedValue(ok(new Map()))
    expect(
      await refusal({ paymentGatewayId: 'pg_1', cashAccountInstanceId: null, currency: 'USD' })
    ).toEqual({ reasonCode: 'ROLE_UNMAPPED', role: 'clearing', railId: 'pg_1' })
    expect(
      await refusal({ paymentGatewayId: null, cashAccountInstanceId: null, currency: 'USD' })
    ).toEqual({ reasonCode: 'ROLE_UNMAPPED', role: 'undeposited_funds' })
  })

  it('names every other endpoint failure ENDPOINT_UNRESOLVED', async () => {
    h.resolveBankAccountGlAccountInTx.mockRejectedValue(
      new UnprocessableEntityError('Refund bank account has no GL account linked')
    )
    expect(
      await refusal({ paymentGatewayId: null, cashAccountInstanceId: 'ba_1', currency: 'USD' })
    ).toEqual({ reasonCode: 'ENDPOINT_UNRESOLVED' })
    expect(
      await refusal({ paymentGatewayId: 'pg_1', cashAccountInstanceId: 'ba_1', currency: 'USD' })
    ).toEqual({ reasonCode: 'ENDPOINT_UNRESOLVED' })
  })
})

describe('validateCashEndpointSource', () => {
  it('accepts each of the three shapes', () => {
    for (const source of [
      { paymentGatewayId: 'pg_1', cashAccountInstanceId: null, currency: 'USD' },
      { paymentGatewayId: null, cashAccountInstanceId: 'ba_1', currency: 'USD' },
      { paymentGatewayId: null, cashAccountInstanceId: null, currency: 'USD' },
    ])
      expect(() => validateCashEndpointSource(source)).not.toThrow()
  })

  it('refuses both at once', () => {
    expect(() =>
      validateCashEndpointSource({
        paymentGatewayId: 'pg_1',
        cashAccountInstanceId: 'ba_1',
        currency: 'USD',
      })
    ).toThrow(UnprocessableEntityError)
  })
})
