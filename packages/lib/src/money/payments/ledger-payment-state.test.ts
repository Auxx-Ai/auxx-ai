// packages/lib/src/money/payments/ledger-payment-state.test.ts
//
// 🛑 `syncInvoicePaymentState` is the ONLY writer of `invoice_status = paid` /
// `partially_paid`, and of the payment-reversal `-> sent`. That is exactly why the field
// pre-hook wall on `invoice_status` exists — a hand-set `paid` records a settled bill with no
// `PaymentTransaction` behind it — and exactly why this call has to be exempt from it
// (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §4).
//
// Writing through `FieldValueService` clears the SYSTEM pre-hook structurally. It does not
// clear the FIELD pre-hook, which fires on this write. Drop `bypassFieldGuards` and recording
// a payment starts failing — the ledger can no longer say what the ledger is for.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  getFieldValues: vi.fn(),
  setValuesForEntity: vi.fn(),
  /** Constructor arguments every `FieldValueService` was built with. */
  fieldValueServiceArgs: [] as unknown[][],
  /** Allocation rows `computeAmountPaid` sums — `{ amount, kind }`, kind from the transaction. */
  allocations: [] as Array<{ kind: string; amount: number }>,
}))

/** Chainable drizzle stub — `computeAmountPaid` sums the rows it resolves to. */
function makeChain() {
  const chain: Record<string, unknown> = {}
  for (const key of ['from', 'innerJoin', 'leftJoin', 'where', 'limit', 'groupBy']) {
    chain[key] = () => chain
  }
  // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(h.allocations).then(resolve)
  return chain
}

vi.mock('@auxx/database', () => ({
  database: {
    select: () => makeChain(),
  },
  schema: new Proxy(
    {},
    { get: (_t, table) => new Proxy({}, { get: (_c, col) => `${String(table)}.${String(col)}` }) }
  ),
}))
vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
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

const { syncInvoicePaymentState } = await import('./ledger')

const ORG = 'org-1'
const USER = 'user-1'
const INVOICE = 'inv-1'

const FIELDS = {
  invoice_status: { id: 'f-status' },
  invoice_total: { id: 'f-total' },
  invoice_amount_paid: { id: 'f-paid' },
  invoice_balance: { id: 'f-balance' },
}

/** The invoice as the ledger finds it, plus the succeeded charges held against it. */
function wireInvoice(params: {
  status: string
  total: number
  amountPaid?: number
  charges?: number[]
}) {
  h.bySystemAttributes.mockResolvedValue(FIELDS)
  const map = new Map<string, unknown>()
  map.set(FIELDS.invoice_status.id, { type: 'option', optionId: params.status })
  map.set(FIELDS.invoice_total.id, { type: 'number', value: params.total })
  map.set(FIELDS.invoice_amount_paid.id, { type: 'number', value: params.amountPaid ?? 0 })
  h.getFieldValues.mockResolvedValue(map)
  h.allocations = (params.charges ?? []).map((amount) => ({ kind: 'charge', amount }))
}

function writtenValues(): Array<{ fieldId: string; value: unknown }> {
  return h.setValuesForEntity.mock.calls[0]?.[0]?.values ?? []
}

/** The bypass set the projection's `FieldValueService` was constructed with. */
function bypass(): ReadonlySet<string> | undefined {
  const options = h.fieldValueServiceArgs[0]?.[4] as
    | { bypassFieldGuards?: ReadonlySet<string> }
    | undefined
  return options?.bypassFieldGuards
}

beforeEach(() => {
  vi.clearAllMocks()
  h.fieldValueServiceArgs = []
  h.allocations = []
})

describe('syncInvoicePaymentState — clearing the wall it justifies', () => {
  it('passes bypassFieldGuards for invoice_status', async () => {
    wireInvoice({ status: 'sent', total: 100, charges: [100] })
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect([...(bypass() ?? [])]).toEqual(['invoice_status'])
  })

  // The other two fields it writes need no exemption: `BILLING_PROJECTION_ATTRS` deliberately
  // excludes `invoice_amount_paid`, and neither it nor `invoice_balance` carries a field
  // pre-hook. Naming them would exempt writes that were never guarded, which is how a
  // projection-owned field quietly becomes writable later.
  it('bypasses that one attribute and nothing else', async () => {
    wireInvoice({ status: 'sent', total: 100, charges: [100] })
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(bypass()?.size).toBe(1)
    expect(bypass()?.has('invoice_amount_paid')).toBe(false)
    expect(bypass()?.has('invoice_balance')).toBe(false)
  })

  // 🛑 The write the bypass is for. If the guard set ever stops covering `paid`, the wall
  // this test's subject exists behind has gone away.
  it('is the write the wall would otherwise refuse', async () => {
    wireInvoice({ status: 'sent', total: 100, charges: [100] })
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_status', value: 'paid' })

    const { guardManualInvoiceLifecycleStatus } = await import(
      '../../field-hooks/pre/lifecycle-status-guard'
    )
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: partial FieldPreHookEvent for the guard
      guardManualInvoiceLifecycleStatus({ newValue: { type: 'option', optionId: 'paid' } } as any)
    ).rejects.toThrow()
  })
})

describe('syncInvoicePaymentState — what it derives', () => {
  it('lands on partially_paid when the ledger is short of the total', async () => {
    wireInvoice({ status: 'sent', total: 100, charges: [40] })
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_status', value: 'partially_paid' })
  })

  // Removing the last payment reverses the status — a `paid` invoice with an empty ledger
  // would be exactly the corruption the wall exists to prevent, arrived at legitimately.
  it('reverses paid back to sent when the ledger empties', async () => {
    wireInvoice({ status: 'paid', total: 100, amountPaid: 100, charges: [] })
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_status', value: 'sent' })
  })

  it('never touches a void invoice', async () => {
    wireInvoice({ status: 'void', total: 100, charges: [100] })
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  // 🛑 The bad-debt entry is posted and A/R has already been credited for the
  // whole balance. This function derives the balance from the payment ledger,
  // which knows nothing about that entry, so without the guard it would write
  // `balance = total - amountPaid` and `status = sent` back over `written_off` -
  // and the invoice would reappear in A/R aging while the write-off still
  // stands, with every posting balanced.
  it('never touches a written-off invoice', async () => {
    wireInvoice({ status: 'written_off', total: 100, amountPaid: 0, charges: [] })
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  it('un-writes-off nothing even when a later payment lands against it', async () => {
    wireInvoice({ status: 'written_off', total: 100, amountPaid: 0, charges: [40] })
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  // No write at all means no service, and therefore no bypass to assert — the guard is only
  // ever consulted for a write that actually changes something.
  it('writes nothing when the projection already agrees', async () => {
    wireInvoice({ status: 'paid', total: 100, amountPaid: 100, charges: [100] })
    h.getFieldValues.mockResolvedValue(
      new Map<string, unknown>([
        [FIELDS.invoice_status.id, { type: 'option', optionId: 'paid' }],
        [FIELDS.invoice_total.id, { type: 'number', value: 100 }],
        [FIELDS.invoice_amount_paid.id, { type: 'number', value: 100 }],
        [FIELDS.invoice_balance.id, { type: 'number', value: 0 }],
      ])
    )
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })
})
