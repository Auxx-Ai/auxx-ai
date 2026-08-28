// packages/lib/src/field-hooks/pre/purchase-order-status-guard.test.ts
//
// 🛑 The bug this file exists to prevent is a guard that cannot fire. By the time
// `fireFieldPreHooks` runs, `validateAndConvertValue` has turned a SINGLE_SELECT write into
// `{ type: 'option', optionId: 'issued' }` — never a bare string — so a guard comparing
// `event.newValue` to `'issued'` passes everything and is indistinguishable from a guard
// nothing has tripped. Every rejection test below therefore feeds the COERCED shape the
// client path actually produces, not the convenient one.

import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../../errors'
import type { FieldPreHookEvent } from '../types'
import { guardManualPurchaseOrderIssued } from './purchase-order-status-guard'

/** The shape `validateAndConvertValue` hands a SINGLE_SELECT pre-hook. */
function coerced(optionId: string) {
  return { type: 'option', optionId }
}

function event(newValue: unknown): FieldPreHookEvent {
  return {
    recordId: 'def-purchase_order:po-1',
    entityDefinitionId: 'def-purchase_order',
    entityType: 'purchase_order',
    entitySlug: 'purchase-orders',
    fieldId: 'f-status',
    systemAttribute: 'purchase_order_status',
    field: { id: 'f-status', systemAttribute: 'purchase_order_status' },
    newValue,
    existingValue: undefined,
    allValues: new Map<string, unknown>(),
    organizationId: 'org-1',
    userId: 'user-1',
    bypass: new Set(),
  } as unknown as FieldPreHookEvent
}

describe('manual issued wall — the client-path shape', () => {
  it('rejects the coerced option envelope a drawer edit produces', async () => {
    await expect(guardManualPurchaseOrderIssued(event(coerced('issued')))).rejects.toThrow(
      BadRequestError
    )
  })

  it('names Send, so the message says which button to press', async () => {
    await expect(guardManualPurchaseOrderIssued(event(coerced('issued')))).rejects.toThrow(
      'Use Send to issue this purchase order'
    )
  })

  // A guard that only handled the envelope and not the bare string would be half-dead the
  // moment a caller writes an already-typed value.
  it('rejects a bare string too', async () => {
    await expect(guardManualPurchaseOrderIssued(event('issued'))).rejects.toThrow(BadRequestError)
  })

  it('rejects a single-element array of either shape', async () => {
    await expect(guardManualPurchaseOrderIssued(event([coerced('issued')]))).rejects.toThrow(
      BadRequestError
    )
    await expect(guardManualPurchaseOrderIssued(event(['issued']))).rejects.toThrow(BadRequestError)
  })
})

describe('manual issued wall — what stays editable', () => {
  // §3.6: `closed` is deliberately NOT derived, because an order where the vendor
  // short-shipped and the remainder has been forgiven must still be closeable by hand.
  it.each(['draft', 'closed', 'canceled'])('leaves %s freely editable', async (status) => {
    const next = coerced(status)
    await expect(guardManualPurchaseOrderIssued(event(next))).resolves.toBe(next)
  })

  it('lets a clear through rather than treating null as a guarded value', async () => {
    await expect(guardManualPurchaseOrderIssued(event(null))).resolves.toBeNull()
  })

  it('returns the value untouched — it is a guard, not a transform', async () => {
    const next = coerced('draft')
    await expect(guardManualPurchaseOrderIssued(event(next))).resolves.toBe(next)
  })
})
