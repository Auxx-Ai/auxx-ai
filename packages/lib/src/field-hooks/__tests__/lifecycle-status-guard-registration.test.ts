// packages/lib/src/field-hooks/__tests__/lifecycle-status-guard-registration.test.ts
//
// 🛑 `quote_status` and `invoice_status` are guarded on BOTH hook chains and they cover
// different doors. The system hook (`resources/hooks/quote-hooks.ts` /
// `invoice-hooks.ts`) runs for `record.create` / `record.update`, the CSV importer and the
// SDK. The field pre-hook runs for `fieldValue.set` / `setBulk` — the drawer, the grid's
// inline edit and a kanban drag, which is how a human would actually type `paid`.
//
// For most of these fields' life only the system half existed, so the guards were on a door
// nobody uses and an invoice could be hand-set to `paid` with no payment behind it
// (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §1). Losing either
// registration narrows coverage silently: nothing throws, the guard simply stops seeing that
// door — which is precisely how the gap survived unnoticed.
//
// Separate from `pre/lifecycle-status-guard.test.ts` because `getFieldPreHooks` self-inits
// the whole hook bootstrap, which needs the real `@auxx/database` module graph.

import { describe, expect, it } from 'vitest'
import {
  guardManualInvoiceLifecycleStatus,
  guardManualQuoteLifecycleStatus,
} from '../pre/lifecycle-status-guard'
import { guardQuoteDraftReturnWithPaidDeposit } from '../pre/quote-deposit-guard'
import { getFieldPreHooks, hasFieldPreHooks } from '../registry'

describe('quote_status guard registration', () => {
  it('is on the field pre-hook chain for quotes', () => {
    expect(hasFieldPreHooks('quotes', 'quote_status')).toBe(true)
    expect(getFieldPreHooks('quotes', 'quote_status')).toContain(guardManualQuoteLifecycleStatus)
  })

  // The deposit wall was here alone and inert. It stays — it walls the opposite transition
  // (`-> draft`), which the action wall does not touch.
  it('keeps the deposit wall alongside it', () => {
    expect(getFieldPreHooks('quotes', 'quote_status')).toContain(
      guardQuoteDraftReturnWithPaidDeposit
    )
  })

  // ORDER IS COST, not semantics: the two are disjoint by value, so this only keeps the
  // deposit wall's query off writes that could never trip it.
  it('runs the in-memory wall before the one that costs a query', () => {
    const hooks = getFieldPreHooks('quotes', 'quote_status')
    expect(hooks.indexOf(guardManualQuoteLifecycleStatus)).toBeLessThan(
      hooks.indexOf(guardQuoteDraftReturnWithPaidDeposit)
    )
  })

  it('is also on the system-hook chain, reachable by entityType', async () => {
    const { getHooksForAttribute } = await import('../../resources/hooks/system-hooks')
    expect(getHooksForAttribute('quote', 'quote_status')).toHaveLength(1)
  })
})

describe('invoice_status guard registration', () => {
  // 🛑 This chain had NO registration at all — not an inert guard, none. It is the one that
  // made `paid` typeable from the drawer.
  it('is on the field pre-hook chain for invoices', () => {
    expect(hasFieldPreHooks('invoices', 'invoice_status')).toBe(true)
    expect(getFieldPreHooks('invoices', 'invoice_status')).toContain(
      guardManualInvoiceLifecycleStatus
    )
  })

  it('is also on the system-hook chain, reachable by entityType', async () => {
    const { getHooksForAttribute } = await import('../../resources/hooks/system-hooks')
    expect(getHooksForAttribute('invoice', 'invoice_status')).toHaveLength(1)
  })
})

describe('one source for what is guarded', () => {
  // The two chains hand guards different shapes, so they cannot share an implementation —
  // only the value set and the message. If those drift, a status is walled on the importer
  // and typeable in the drawer (or the reverse) and nothing says so.
  it.each([
    {
      document: 'quote',
      attr: 'quote_status',
      fieldGuard: guardManualQuoteLifecycleStatus,
      values: ['sent', 'approved'],
      hooks: () => import('../../resources/hooks/quote-hooks').then((m) => m.QUOTE_HOOKS),
      constants: 'QUOTE_ACTION_STATUSES',
      messageKey: 'QUOTE_ACTION_STATUS_MESSAGE',
    },
    {
      document: 'invoice',
      attr: 'invoice_status',
      fieldGuard: guardManualInvoiceLifecycleStatus,
      values: ['sent', 'partially_paid', 'paid', 'void', 'written_off'],
      hooks: () => import('../../resources/hooks/invoice-hooks').then((m) => m.INVOICE_HOOKS),
      constants: 'INVOICE_ACTION_STATUSES',
      messageKey: 'INVOICE_ACTION_STATUS_MESSAGE',
    },
  ])('$document guards the same value set and message on both chains', async (spec) => {
    const lifecycle = (await import('../../resources/hooks/lifecycle-status-guard')) as Record<
      string,
      unknown
    >
    expect([...(lifecycle[spec.constants] as readonly string[])]).toEqual(spec.values)
    const message = lifecycle[spec.messageKey] as string

    const registry = await spec.hooks()
    const systemHook = registry[spec.attr]![0]!
    await expect(
      systemHook({
        operation: 'update',
        field: { id: 'f-status', systemAttribute: spec.attr },
        values: { 'f-status': spec.values[0] },
        // biome-ignore lint/suspicious/noExplicitAny: partial SystemHookContext for the guard
      } as any)
    ).rejects.toThrow(message)

    // The SAME value, in the shape the field chain actually delivers.
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: partial FieldPreHookEvent for the guard
      spec.fieldGuard({ newValue: { type: 'option', optionId: spec.values[0] } } as any)
    ).rejects.toThrow(message)
  })
})
