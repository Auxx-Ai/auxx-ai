// packages/lib/src/field-hooks/pre/lifecycle-status-guard.test.ts
//
// 🛑 The bug this file exists to prevent is a guard that cannot fire. By the time
// `fireFieldPreHooks` runs, `validateAndConvertValue` has turned a SINGLE_SELECT write into
// `{ type: 'option', optionId: 'paid' }` — never a bare string — so a guard comparing
// `event.newValue` to `'paid'` passes everything and is indistinguishable from a guard
// nothing has tripped. That is exactly what `guardQuoteDraftReturnWithPaidDeposit` did from
// the day it shipped (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §2), and
// it passed review and its own unit test because both fed it a bare string.
//
// So: every rejection test below feeds the COERCED shape the client path actually produces.
// A version of these guards that only understood bare strings would pass the `it('rejects a
// bare string')` cases and fail every `coerced(...)` one, which is the whole point.

import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../../errors'
import {
  INVOICE_ACTION_STATUS_MESSAGE,
  QUOTE_ACTION_STATUS_MESSAGE,
} from '../../resources/hooks/lifecycle-status-guard'
import type { FieldPreHookEvent, FieldPreHookHandler } from '../types'
import {
  guardManualInvoiceLifecycleStatus,
  guardManualQuoteLifecycleStatus,
} from './lifecycle-status-guard'

/** The shape `validateAndConvertValue` hands a SINGLE_SELECT pre-hook. */
function coerced(optionId: string) {
  return { type: 'option', optionId }
}

function event(newValue: unknown): FieldPreHookEvent {
  return {
    recordId: 'def-invoice:inv-1',
    entityDefinitionId: 'def-invoice',
    entityType: 'invoice',
    entitySlug: 'invoices',
    fieldId: 'f-status',
    systemAttribute: 'invoice_status',
    field: { id: 'f-status', systemAttribute: 'invoice_status' },
    newValue,
    existingValue: undefined,
    allValues: new Map<string, unknown>(),
    organizationId: 'org-1',
    userId: 'user-1',
    bypass: new Set(),
  } as unknown as FieldPreHookEvent
}

const CASES: Array<{
  name: string
  guard: FieldPreHookHandler
  guarded: string[]
  open: string[]
  message: string
}> = [
  {
    name: 'quote_status',
    guard: guardManualQuoteLifecycleStatus,
    // Both mirror the linked `service_request`; a typed status skips the mirror and leaves
    // the request in the pipeline for a quote that has already been answered.
    guarded: ['sent', 'approved'],
    // `declined` has a sanctioned writer but no side effect a manual write would skip, and
    // `draft` is the edit-a-sent-quote flow — walled separately, and only when a deposit
    // has been paid, by `quote-deposit-guard.ts`.
    open: ['draft', 'declined', 'canceled'],
    message: QUOTE_ACTION_STATUS_MESSAGE,
  },
  {
    name: 'invoice_status',
    guard: guardManualInvoiceLifecycleStatus,
    // 🛑 `paid` is the one that corrupts money: hand-set, the bill reads settled with no
    // `PaymentTransaction`, no allocation and no `invoice_amount_paid` behind it.
    guarded: ['sent', 'partially_paid', 'paid', 'void'],
    // Both the edit-a-sent-invoice flow and un-voiding write `draft` directly.
    open: ['draft'],
    message: INVOICE_ACTION_STATUS_MESSAGE,
  },
]

describe.each(CASES)('$name manual-write wall', (spec) => {
  it.each(spec.guarded)('rejects the coerced option envelope for %s', async (status) => {
    await expect(spec.guard(event(coerced(status)))).rejects.toThrow(BadRequestError)
  })

  it('names the actions, so the message says which button to press', async () => {
    await expect(spec.guard(event(coerced(spec.guarded[0]!)))).rejects.toThrow(spec.message)
  })

  // A guard that only handled the envelope would be half-dead the moment a caller writes an
  // already-typed value — and the system-hook twin passes exactly that shape.
  it.each(spec.guarded)('rejects a bare string %s too', async (status) => {
    await expect(spec.guard(event(status))).rejects.toThrow(BadRequestError)
  })

  it('rejects a single-element array of either shape', async () => {
    const status = spec.guarded[0]!
    await expect(spec.guard(event([coerced(status)]))).rejects.toThrow(BadRequestError)
    await expect(spec.guard(event([status]))).rejects.toThrow(BadRequestError)
  })

  it.each(spec.open)('leaves %s freely editable', async (status) => {
    const next = coerced(status)
    await expect(spec.guard(event(next))).resolves.toBe(next)
  })

  it('lets a clear through rather than treating null as a guarded value', async () => {
    await expect(spec.guard(event(null))).resolves.toBeNull()
  })

  it('returns the value untouched — it is a guard, not a transform', async () => {
    const next = coerced(spec.open[0]!)
    await expect(spec.guard(event(next))).resolves.toBe(next)
  })
})

describe('the guarded sets do not leak into each other', () => {
  // `approved` is a quote word and `paid` an invoice one. Building both guards from one
  // factory makes swapping the two constant arrays a one-character mistake that nothing else
  // would catch — each document would then guard the other's values and none of its own.
  it('does not let the quote guard reject an invoice-only status', async () => {
    const next = coerced('paid')
    await expect(guardManualQuoteLifecycleStatus(event(next))).resolves.toBe(next)
  })

  it('does not let the invoice guard reject a quote-only status', async () => {
    const next = coerced('approved')
    await expect(guardManualInvoiceLifecycleStatus(event(next))).resolves.toBe(next)
  })
})
