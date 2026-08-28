// packages/lib/src/resources/hooks/__tests__/lifecycle-status-guard.test.ts
//
// `rejectManualLifecycleStatus` existed VERBATIM twice (quote + invoice) and a purchase
// order is the third caller (plans/purchasing/07-purchase-order-send-and-status.md §3.4).
// The extraction is only safe if it preserves three behaviours that are easy to lose and
// silent when lost: the create bypass, the two value-keying conventions, and the fact that
// unguarded values stay freely editable (the edit-back-to-draft flow).

import { describe, expect, it, vi } from 'vitest'
import { BadRequestError } from '../../../errors'
import type { SystemHookContext } from '../types'

vi.mock('../../../records/record-numbering', () => ({
  recordNumbering: { create: vi.fn() },
}))

const { createLifecycleStatusGuard } = await import('../lifecycle-status-guard')
const { QUOTE_HOOKS } = await import('../quote-hooks')
const { INVOICE_HOOKS } = await import('../invoice-hooks')
const { PURCHASE_ORDER_HOOKS } = await import('../purchasing-hooks')

const FIELD_ID = 'field-status'

function ctx(
  systemAttribute: string,
  values: Record<string, unknown>,
  operation: 'create' | 'update' = 'update'
): SystemHookContext {
  return {
    operation,
    entityDef: { id: 'def-1', entityType: 'anything' },
    field: { id: FIELD_ID, type: 'SINGLE_SELECT', systemAttribute },
    values,
    organizationId: 'org-1',
    userId: 'user-1',
    allFields: [],
  } as unknown as SystemHookContext
}

/** The one guard registered per document, so the tests exercise the real registration. */
const GUARDS = {
  quote: {
    attr: 'quote_status',
    hook: QUOTE_HOOKS.quote_status![0]!,
    guarded: ['sent', 'approved'],
    open: ['draft', 'declined', 'canceled'],
    message: /quote actions/,
  },
  invoice: {
    attr: 'invoice_status',
    hook: INVOICE_HOOKS.invoice_status![0]!,
    guarded: ['sent', 'partially_paid', 'paid', 'void'],
    open: ['draft'],
    message: /invoice actions/,
  },
  purchase_order: {
    attr: 'purchase_order_status',
    hook: PURCHASE_ORDER_HOOKS.purchase_order_status![0]!,
    // §3.4: `issued` is what SENDING does, so it stops being a dropdown value.
    guarded: ['issued'],
    // §3.6: `closed` is deliberately NOT derived — an order whose remainder has been
    // forgiven must still be closeable by a human, so these three stay editable.
    open: ['draft', 'closed', 'canceled'],
    message: /Send/,
  },
} as const

describe.each(Object.entries(GUARDS))('%s lifecycle status guard', (_name, spec) => {
  it.each(spec.guarded)('rejects a manual write of %s', async (value) => {
    await expect(spec.hook(ctx(spec.attr, { [FIELD_ID]: value }))).rejects.toThrow(BadRequestError)
    await expect(spec.hook(ctx(spec.attr, { [FIELD_ID]: value }))).rejects.toThrow(spec.message)
  })

  it.each(spec.open)('leaves %s freely editable', async (value) => {
    const values = { [FIELD_ID]: value }
    await expect(spec.hook(ctx(spec.attr, values))).resolves.toEqual(values)
  })

  // A create cannot legitimately start in a guarded state — every one of these fields has
  // `defaultValue: 'draft'` — and running the check on create would refuse a create that
  // merely echoed a value back.
  it.each(spec.guarded)('does not run on create (%s)', async (value) => {
    const values = { [FIELD_ID]: value }
    await expect(spec.hook(ctx(spec.attr, values, 'create'))).resolves.toEqual(values)
  })

  // `UnifiedCrudHandler.runPreHooks` dispatches on EITHER key, so a guard reading only one
  // of them is silently bypassed by half the callers.
  it('rejects a value keyed by systemAttribute, not just by fieldId', async () => {
    const guardedValue = spec.guarded[0]
    await expect(spec.hook(ctx(spec.attr, { [spec.attr]: guardedValue }))).rejects.toThrow(
      BadRequestError
    )
  })

  // SINGLE_SELECT values arrive array-wrapped from some surfaces and scalar from others.
  it('rejects a single-element array as well as a scalar', async () => {
    const guardedValue = spec.guarded[0]
    await expect(spec.hook(ctx(spec.attr, { [FIELD_ID]: [guardedValue] }))).rejects.toThrow(
      BadRequestError
    )
    await expect(spec.hook(ctx(spec.attr, { [spec.attr]: [guardedValue] }))).rejects.toThrow(
      BadRequestError
    )
  })
})

describe('createLifecycleStatusGuard', () => {
  it('ignores an update that does not touch the guarded field at all', async () => {
    const guard = createLifecycleStatusGuard({ guardedValues: ['sent'], message: 'nope' })
    const values = { 'some-other-field': 'sent' }
    await expect(guard(ctx('quote_status', values))).resolves.toEqual(values)
  })

  it('throws the caller’s message verbatim, so the UI names the right action', async () => {
    const guard = createLifecycleStatusGuard({
      guardedValues: ['issued'],
      message: 'Use Send to issue this purchase order',
    })
    await expect(guard(ctx('purchase_order_status', { [FIELD_ID]: 'issued' }))).rejects.toThrow(
      'Use Send to issue this purchase order'
    )
  })

  // Guarding on a Set of unknowns rather than string equality must not start matching
  // things the `===` chain never matched.
  it('does not match a non-string value that stringifies to a guarded one', async () => {
    const guard = createLifecycleStatusGuard({ guardedValues: ['1'], message: 'nope' })
    const values = { [FIELD_ID]: 1 }
    await expect(guard(ctx('quote_status', values))).resolves.toEqual(values)
  })

  it('returns the values object untouched when nothing is guarded', async () => {
    const guard = createLifecycleStatusGuard({ guardedValues: [], message: 'nope' })
    const values = { [FIELD_ID]: 'sent' }
    await expect(guard(ctx('quote_status', values))).resolves.toEqual(values)
  })
})
