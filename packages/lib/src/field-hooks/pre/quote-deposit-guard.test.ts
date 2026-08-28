// packages/lib/src/field-hooks/pre/quote-deposit-guard.test.ts
//
// 🛑 This guard shipped inert and had never fired
// (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §2). It unwrapped the ARRAY
// case and compared the result to `'draft'` — but on the field pre-hook chain
// `validateAndConvertValue` has already run, so a SINGLE_SELECT arrives as
// `{ type: 'option', optionId: 'draft' }` and never as a bare string. The comparison could
// not be true, so it returned early on every write and a paid quote could be edited back to
// draft, orphaning the deposit charge it was built to protect.
//
// The trap is that a unit test feeding a bare string passes against BOTH the broken and the
// fixed version. So the rejection case here feeds the coerced envelope, and the bare-string
// case exists only to prove the fix did not trade one shape for the other.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ findFirst: vi.fn() }))

vi.mock('@auxx/database', () => ({
  database: { query: { PaymentTransaction: { findFirst: h.findFirst } } },
  schema: {
    PaymentTransaction: {
      organizationId: 'organizationId',
      quoteInstanceId: 'quoteInstanceId',
      kind: 'kind',
      status: 'status',
    },
  },
}))

const { BadRequestError } = await import('../../errors')
const { guardQuoteDraftReturnWithPaidDeposit } = await import('./quote-deposit-guard')

import type { FieldPreHookEvent } from '../types'

/** The shape `validateAndConvertValue` hands a SINGLE_SELECT pre-hook. */
function coerced(optionId: string) {
  return { type: 'option', optionId }
}

function event(newValue: unknown): FieldPreHookEvent {
  return {
    recordId: 'def-quote:quote-1',
    entityDefinitionId: 'def-quote',
    entityType: 'quote',
    entitySlug: 'quotes',
    fieldId: 'f-status',
    systemAttribute: 'quote_status',
    field: { id: 'f-status', systemAttribute: 'quote_status' },
    newValue,
    existingValue: undefined,
    allValues: new Map<string, unknown>(),
    organizationId: 'org-1',
    userId: 'user-1',
    bypass: new Set(),
  } as unknown as FieldPreHookEvent
}

beforeEach(() => {
  h.findFirst.mockReset()
})

describe('return-to-draft wall with a paid deposit', () => {
  // The case the guard exists for, in the shape production delivers. This is the assertion
  // that fails against the version that shipped.
  it('rejects the coerced option envelope a drawer edit produces', async () => {
    h.findFirst.mockResolvedValue({ id: 'txn-1' })
    await expect(guardQuoteDraftReturnWithPaidDeposit(event(coerced('draft')))).rejects.toThrow(
      BadRequestError
    )
  })

  it('says why, naming the deposit rather than the rule', async () => {
    h.findFirst.mockResolvedValue({ id: 'txn-1' })
    await expect(guardQuoteDraftReturnWithPaidDeposit(event(coerced('draft')))).rejects.toThrow(
      'a deposit has been paid against it'
    )
  })

  it('rejects the array-wrapped and bare shapes too', async () => {
    h.findFirst.mockResolvedValue({ id: 'txn-1' })
    await expect(guardQuoteDraftReturnWithPaidDeposit(event([coerced('draft')]))).rejects.toThrow(
      BadRequestError
    )
    await expect(guardQuoteDraftReturnWithPaidDeposit(event('draft'))).rejects.toThrow(
      BadRequestError
    )
  })
})

describe('what still gets through', () => {
  it('allows the return to draft when no deposit was ever paid', async () => {
    h.findFirst.mockResolvedValue(undefined)
    const next = coerced('draft')
    await expect(guardQuoteDraftReturnWithPaidDeposit(event(next))).resolves.toBe(next)
  })

  // The wall is about ONE transition. Every other status write must skip the query entirely —
  // this guard sits on `quote_status`, so it sees every write to the field.
  it.each([
    'sent',
    'approved',
    'declined',
    'canceled',
  ])('leaves %s alone without touching the ledger', async (status) => {
    const next = coerced(status)
    await expect(guardQuoteDraftReturnWithPaidDeposit(event(next))).resolves.toBe(next)
    expect(h.findFirst).not.toHaveBeenCalled()
  })

  it('lets a clear through rather than treating null as a return to draft', async () => {
    await expect(guardQuoteDraftReturnWithPaidDeposit(event(null))).resolves.toBeNull()
    expect(h.findFirst).not.toHaveBeenCalled()
  })
})
