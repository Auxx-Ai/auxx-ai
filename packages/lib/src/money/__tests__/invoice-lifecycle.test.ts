// packages/lib/src/money/__tests__/invoice-lifecycle.test.ts
//
// 🛑 The regression this file exists to prevent: `invoice_status` is guarded on BOTH hook
// chains and the two are cleared by DIFFERENT mechanisms. Writing through
// `FieldValueService` instead of `UnifiedCrudHandler` clears the system pre-hook
// structurally — `runPreHooks` never runs. It does NOT clear the field pre-hook, which fires
// on exactly these writes; only `bypassFieldGuards` does
// (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §4).
//
// `invoice_status` is the sharpest case in that plan: it had no field pre-hook at all, so
// `paid` was typeable from the drawer with no payment behind it. Adding the wall is what
// makes these bypasses load-bearing — without them Send and Void stop working, and nothing
// says so until somebody presses the button.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  getFieldValues: vi.fn(),
  setValuesForEntity: vi.fn(),
  hasSucceededCharges: vi.fn(),
  listInvoiceAllocations: vi.fn(),
  /** Constructor arguments every `FieldValueService` was built with. */
  fieldValueServiceArgs: [] as unknown[][],
  /** `WorkOrderBillingInstallment` rows the update statement claimed to touch. */
  installmentUpdates: [] as unknown[],
}))

vi.mock('@auxx/database', () => {
  const chain = {
    set: (values: unknown) => {
      h.installmentUpdates.push(values)
      return chain
    },
    where: () => Promise.resolve(),
  }
  return {
    database: { update: () => chain },
    schema: {
      WorkOrderBillingInstallment: {
        organizationId: 'organizationId',
        invoiceId: 'invoiceId',
        status: 'status',
      },
    },
  }
})
vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
  getEntityDefIdResolver: async () => (slug: string) => `def-${slug}`,
}))
vi.mock('../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    getFieldValues = h.getFieldValues
  },
}))
vi.mock('../../field-values/field-value-service', () => ({
  FieldValueService: class {
    constructor(...args: unknown[]) {
      h.fieldValueServiceArgs.push(args)
    }
    setValuesForEntity = h.setValuesForEntity
  },
}))
vi.mock('../billing-allocations', () => ({
  listInvoiceAllocations: h.listInvoiceAllocations,
  releaseInvoiceAllocations: vi.fn(),
}))
vi.mock('../billing-projection', () => ({
  syncInvoiceBillingProjection: vi.fn(),
  syncWorkOrderBillingProjection: vi.fn(),
}))
vi.mock('../payments/ledger', () => ({ hasSucceededCharges: h.hasSucceededCharges }))

const { markInvoiceSent, voidInvoice } = await import('../invoice-lifecycle')
const { BadRequestError } = await import('../../errors')

const ORG = 'org-1'
const USER = 'user-1'
const INVOICE = 'inv-1'

const STATUS_FIELD = { id: 'f-invoice-status' }
const ISSUED_FIELD = { id: 'f-invoice-issued-at' }

/**
 * `bySystemAttributes` is called for the status read and again for `invoice_issued_at`.
 * Answer by what was asked for. `issuedAt: undefined` means the stamp is still empty.
 */
function wireInvoice(status: string, options: { issuedAt?: string } = {}) {
  h.bySystemAttributes.mockImplementation((attrs: readonly string[]) =>
    Promise.resolve(
      attrs.includes('invoice_status')
        ? { invoice_status: STATUS_FIELD }
        : { invoice_issued_at: ISSUED_FIELD }
    )
  )
  h.getFieldValues.mockImplementation((_recordId: string, fieldIds: string[]) => {
    const map = new Map<string, unknown>()
    if (fieldIds.includes(STATUS_FIELD.id)) {
      map.set(STATUS_FIELD.id, { type: 'option', optionId: status })
    }
    if (fieldIds.includes(ISSUED_FIELD.id) && options.issuedAt) {
      map.set(ISSUED_FIELD.id, { type: 'date', value: options.issuedAt })
    }
    return Promise.resolve(map)
  })
}

function writtenValues(): Array<{ fieldId: string; value: unknown }> {
  return h.setValuesForEntity.mock.calls[0]?.[0]?.values ?? []
}

/** The bypass set the first `FieldValueService` was constructed with. */
function bypass(): ReadonlySet<string> | undefined {
  const options = h.fieldValueServiceArgs[0]?.[4] as
    | { bypassFieldGuards?: ReadonlySet<string> }
    | undefined
  return options?.bypassFieldGuards
}

beforeEach(() => {
  vi.clearAllMocks()
  h.fieldValueServiceArgs = []
  h.installmentUpdates = []
  h.hasSucceededCharges.mockResolvedValue(false)
  h.listInvoiceAllocations.mockResolvedValue({
    lineAllocations: [],
    visitAllocations: [],
    scheduleAllocations: [],
  })
})

describe('markInvoiceSent', () => {
  it('writes sent from draft', async () => {
    wireInvoice('draft')
    await markInvoiceSent({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_status', value: 'sent' })
  })

  it('refuses to run from any status but draft', async () => {
    wireInvoice('sent')
    await expect(
      markInvoiceSent({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    ).rejects.toThrow(BadRequestError)
  })

  // The side effects a typed `sent` would skip — the reason the value is guarded at all.
  it('stamps invoice_issued_at when it is still empty', async () => {
    wireInvoice('draft')
    await markInvoiceSent({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(writtenValues().map((w) => w.fieldId)).toContain('invoice_issued_at')
  })

  it('leaves a stamp that is already there alone', async () => {
    wireInvoice('draft', { issuedAt: '2026-01-01' })
    await markInvoiceSent({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(writtenValues().map((w) => w.fieldId)).not.toContain('invoice_issued_at')
  })

  it('flips the drafted installment to invoiced', async () => {
    wireInvoice('draft')
    await markInvoiceSent({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(h.installmentUpdates).toEqual([{ status: 'invoiced' }])
  })
})

describe('voidInvoice', () => {
  it('writes void', async () => {
    wireInvoice('sent')
    await voidInvoice({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(writtenValues()).toEqual([{ fieldId: 'invoice_status', value: 'void' }])
  })

  it('refuses while a succeeded payment exists', async () => {
    wireInvoice('sent')
    h.hasSucceededCharges.mockResolvedValue(true)
    await expect(
      voidInvoice({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    ).rejects.toThrow(BadRequestError)
  })
})

describe('clearing their own guards', () => {
  const ACTIONS = [
    { name: 'markInvoiceSent', run: markInvoiceSent, from: 'draft' },
    { name: 'voidInvoice', run: voidInvoice, from: 'sent' },
  ] as const

  // The whole mechanism. `fireFieldPreHooks` short-circuits on
  // `ctx.bypassFieldGuards.has(systemAttribute)` before any handler runs.
  it.each(ACTIONS)('$name passes bypassFieldGuards for invoice_status', async (action) => {
    wireInvoice(action.from)
    await action.run({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect([...(bypass() ?? [])]).toEqual(['invoice_status'])
  })

  // 🛑 `markInvoiceSent` writes `invoice_issued_at` on the same service. Naming it here too
  // would be the easy mistake: that field carries no guard today, and exempting a field a
  // bypass does not need is how a projection-owned field quietly becomes writable later.
  it.each(ACTIONS)('$name bypasses that one attribute and nothing else', async (action) => {
    wireInvoice(action.from)
    await action.run({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(bypass()?.size).toBe(1)
    expect(bypass()?.has('invoice_issued_at')).toBe(false)
  })

  // The other half of the proof: without the bypass, this exact write is refused. If this
  // ever stops throwing, the bypasses above have become decoration and the wall is inert.
  it.each(['sent', 'void'])('is refused by the field pre-hook without a bypass (%s)', async (v) => {
    const { guardManualInvoiceLifecycleStatus } = await import(
      '../../field-hooks/pre/lifecycle-status-guard'
    )
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: partial FieldPreHookEvent for the guard
      guardManualInvoiceLifecycleStatus({ newValue: { type: 'option', optionId: v } } as any)
    ).rejects.toThrow(BadRequestError)
  })
})
