// packages/lib/src/postings/__tests__/refund-effect-types.test.ts

import { describe, expect, it } from 'vitest'
import {
  acceptedCustomerRefundEffectBasisSchema,
  customerRefundAccountingBasisSchema,
} from '../refund-effect-types'

const route = {
  kind: 'rail' as const,
  paymentGatewayId: 'gateway-1',
  settlementCurrency: 'USD',
  endpointGlAccountId: 'gl-clearing',
}

const manualRoute = {
  kind: 'manual' as const,
  method: 'bank' as const,
  debitSelectedBy: 'bank_account' as const,
  bankAccountInstanceId: 'bank-1',
  endpointGlAccountId: 'gl-cash',
}

const undepositedRoute = {
  kind: 'manual' as const,
  method: 'cash' as const,
  debitSelectedBy: 'undeposited_funds' as const,
  bankAccountInstanceId: null,
  endpointGlAccountId: 'gl-undeposited',
}

function calculation(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    moneyTransactionId: 'refund-1',
    currency: 'USD' as const,
    currencyExponent: 2 as const,
    amountMinor: '150',
    datePrecision: 'date' as const,
    occurredAt: null,
    occurredOn: '2026-09-15',
    effectiveDate: '2026-09-15',
    creditMemoInstanceIds: ['memo-1', 'memo-2'],
    settlements: [
      {
        settlementId: 'settlement-1',
        creditMemoInstanceId: 'memo-1',
        amountMinor: '100',
        creditControlAccountId: 'gl-ar',
      },
      {
        settlementId: 'settlement-2',
        creditMemoInstanceId: 'memo-2',
        amountMinor: '50',
        creditControlAccountId: 'gl-ar',
      },
    ],
    route,
    sourceHash: 'a'.repeat(64),
    ...overrides,
  }
}

describe('customer refund accounting basis', () => {
  it('accepts a fully partitioned multi-credit refund with a rail identity', () => {
    expect(customerRefundAccountingBasisSchema.safeParse(calculation()).success).toBe(true)
  })

  it.each(['gateway-2', 'gateway-3'])('accepts rail identity %s', (paymentGatewayId) => {
    expect(
      customerRefundAccountingBasisSchema.safeParse(
        calculation({ route: { ...route, paymentGatewayId } })
      ).success
    ).toBe(true)
  })

  it('accepts both halves of the two-way manual endpoint', () => {
    expect(
      customerRefundAccountingBasisSchema.safeParse(calculation({ route: manualRoute })).success
    ).toBe(true)
    expect(
      customerRefundAccountingBasisSchema.safeParse(calculation({ route: undepositedRoute }))
        .success
    ).toBe(true)
  })

  // Both mismatches balance, so only the schema can catch them.
  it.each([
    { ...manualRoute, bankAccountInstanceId: null },
    { ...undepositedRoute, bankAccountInstanceId: 'bank-1' },
  ])('rejects a manual endpoint whose bank account and selection disagree', (route) => {
    expect(customerRefundAccountingBasisSchema.safeParse(calculation({ route })).success).toBe(
      false
    )
  })

  it.each([
    { settlements: calculation().settlements.slice(0, 1) },
    { settlements: [...calculation().settlements, { ...calculation().settlements[0] }] },
    { route: { ...route, kind: 'manual' } },
    { occurredOn: null, datePrecision: 'date' },
  ])('rejects an incomplete or ambiguous refund basis', (override) => {
    expect(customerRefundAccountingBasisSchema.safeParse(calculation(override)).success).toBe(false)
  })

  it('pins every accepted contribution to its resolved account and exact amount', () => {
    const calc = calculation()
    const accepted = {
      version: 1 as const,
      sourceBasisVersion: 1,
      sourceHash: calc.sourceHash,
      policyKey: 'customer_refund_v1' as const,
      policyVersion: 1 as const,
      effectiveDate: calc.effectiveDate,
      bookTimeZone: 'UTC',
      currency: 'USD' as const,
      currencyExponent: 2 as const,
      documentRefs: [
        { resourceKind: 'money_transaction', entityInstanceId: 'refund-1' },
        { resourceKind: 'credit_memo', entityInstanceId: 'memo-1' },
        { resourceKind: 'credit_memo', entityInstanceId: 'memo-2' },
      ],
      calculation: calc,
      accountResolution: [
        {
          lineKey: 'line:0',
          glAccountId: 'gl-ar',
          accountRole: null,
          selectedBy: 'original_effect' as const,
          configurationHash: 'b'.repeat(64),
        },
        {
          lineKey: 'line:1',
          glAccountId: 'gl-ar',
          accountRole: null,
          selectedBy: 'original_effect' as const,
          configurationHash: 'c'.repeat(64),
        },
        {
          lineKey: 'line:2',
          glAccountId: 'gl-clearing',
          accountRole: null,
          selectedBy: 'route' as const,
          configurationHash: 'd'.repeat(64),
        },
      ],
      contribution: [
        {
          lineKey: 'line:0',
          glAccountId: 'gl-ar',
          direction: 'debit' as const,
          amountMinor: '100',
          counterpartyType: 'customer' as const,
          counterpartyId: 'contact-1',
          dimensions: { creditMemoInstanceId: 'memo-1', settlementId: 'settlement-1' },
        },
        {
          lineKey: 'line:1',
          glAccountId: 'gl-ar',
          direction: 'debit' as const,
          amountMinor: '50',
          counterpartyType: 'customer' as const,
          counterpartyId: 'contact-1',
          dimensions: { creditMemoInstanceId: 'memo-2', settlementId: 'settlement-2' },
        },
        {
          lineKey: 'line:2',
          glAccountId: 'gl-clearing',
          direction: 'credit' as const,
          amountMinor: '150',
          counterpartyType: null,
          counterpartyId: null,
          dimensions: { route: 'route-1' },
        },
      ],
    }
    expect(acceptedCustomerRefundEffectBasisSchema.safeParse(accepted).success).toBe(true)
    expect(
      acceptedCustomerRefundEffectBasisSchema.safeParse({
        ...accepted,
        contribution: accepted.contribution.map((line, i) =>
          i === 2 ? { ...line, amountMinor: '149' } : line
        ),
      }).success
    ).toBe(false)
  })
})
