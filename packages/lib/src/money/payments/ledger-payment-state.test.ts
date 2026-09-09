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
  /** `credit_memo_application_amount` per application row `computeAmountCredited` sums. */
  applications: [] as number[],
  listFiltered: vi.fn(),
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
    listFiltered = h.listFiltered
  },
}))
vi.mock('../../field-values/read-field-scalars', () => ({
  readFieldScalars: async (_db: unknown, _org: string, instanceIds: string[], fieldIds: string[]) =>
    new Map(instanceIds.map((id, index) => [id, new Map([[fieldIds[0]!, h.applications[index]]])])),
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
  invoice_amount_credited: { id: 'f-credited' },
  invoice_balance: { id: 'f-balance' },
  credit_memo_application_amount: { id: 'f-app-amount' },
}

/** The invoice as the ledger finds it, plus the succeeded charges and applied credit against it. */
function wireInvoice(params: {
  status: string
  total: number
  amountPaid?: number
  amountCredited?: number
  charges?: number[]
  /** One `credit_memo_application` row per amount. */
  credits?: number[]
}) {
  h.bySystemAttributes.mockResolvedValue(FIELDS)
  const map = new Map<string, unknown>()
  map.set(FIELDS.invoice_status.id, { type: 'option', optionId: params.status })
  map.set(FIELDS.invoice_total.id, { type: 'number', value: params.total })
  map.set(FIELDS.invoice_amount_paid.id, { type: 'number', value: params.amountPaid ?? 0 })
  map.set(FIELDS.invoice_amount_credited.id, {
    type: 'number',
    value: params.amountCredited ?? 0,
  })
  h.getFieldValues.mockResolvedValue(map)
  h.allocations = (params.charges ?? []).map((amount) => ({ kind: 'charge', amount }))
  h.applications = params.credits ?? []
  h.listFiltered.mockResolvedValue({ ids: h.applications.map((_, index) => `app-${index}`) })
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
  h.applications = []
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
    expect(bypass()?.has('invoice_amount_credited')).toBe(false)
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

// plans/accounting/tasks/10-credit-memos.md §2.3: an application is not money and has no
// `PaymentAllocation`. The memo's issue entry already credited `1100` for it, so an invoice
// that did not subtract its applied credit would carry a balance the ledger no longer does.
describe('syncInvoicePaymentState - applied credit', () => {
  it('lists the applications by the invoice they were applied to', async () => {
    wireInvoice({ status: 'sent', total: 500, credits: [120] })
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    const listArg = h.listFiltered.mock.calls[0]![0] as {
      entityDefinitionId: string
      filters: Array<{ conditions: Array<{ fieldId: string; operator: string; value: unknown }> }>
    }
    expect(listArg.entityDefinitionId).toBe('credit_memo_application')
    expect(listArg.filters[0]!.conditions[0]).toMatchObject({
      fieldId: 'credit_memo_application:invoice',
      operator: 'is',
      value: `invoice:${INVOICE}`,
    })
  })

  it('subtracts applied credit from the balance and writes invoice_amount_credited', async () => {
    wireInvoice({ status: 'sent', total: 500, credits: [120] })
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_amount_credited', value: 120 })
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_balance', value: 380 })
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_status', value: 'partially_paid' })
  })

  it('sums every application, not just the first', async () => {
    wireInvoice({ status: 'sent', total: 500, credits: [120, 80] })
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_amount_credited', value: 200 })
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_balance', value: 300 })
  })

  it('lands on paid when credit alone settles the invoice', async () => {
    wireInvoice({ status: 'sent', total: 120, credits: [120] })
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_status', value: 'paid' })
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_balance', value: 0 })
    // Nothing was PAID. The paid figure stays honest; only the credit figure moved.
    expect(writtenValues()).not.toContainEqual(
      expect.objectContaining({ fieldId: 'invoice_amount_paid' })
    )
  })

  it('lands on paid when money and credit together reach the total', async () => {
    wireInvoice({ status: 'partially_paid', total: 500, amountPaid: 380, charges: [380] })
    h.applications = [120]
    h.listFiltered.mockResolvedValue({ ids: ['app-0'] })
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_status', value: 'paid' })
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_balance', value: 0 })
  })

  // §8 step 3: unapply, and the invoice is back at its full balance.
  it('reverses to sent and clears the credit figure when the application is removed', async () => {
    wireInvoice({ status: 'partially_paid', total: 500, amountCredited: 120, credits: [] })
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_amount_credited', value: 0 })
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_balance', value: 500 })
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_status', value: 'sent' })
  })

  it('does not rewrite a credit figure that already agrees', async () => {
    wireInvoice({ status: 'partially_paid', total: 500, amountCredited: 120, credits: [120] })
    h.getFieldValues.mockResolvedValue(
      new Map<string, unknown>([
        [FIELDS.invoice_status.id, { type: 'option', optionId: 'partially_paid' }],
        [FIELDS.invoice_total.id, { type: 'number', value: 500 }],
        [FIELDS.invoice_amount_paid.id, { type: 'number', value: 0 }],
        [FIELDS.invoice_amount_credited.id, { type: 'number', value: 120 }],
        [FIELDS.invoice_balance.id, { type: 'number', value: 380 }],
      ])
    )
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(h.setValuesForEntity).not.toHaveBeenCalled()
  })

  // An org whose registry has no application field yet has nothing to sum, and must not
  // be asked to list a def it does not have.
  it('reads zero credit when the org has no application field', async () => {
    wireInvoice({ status: 'sent', total: 100, charges: [40] })
    h.bySystemAttributes.mockResolvedValue({ ...FIELDS, credit_memo_application_amount: null })
    await syncInvoicePaymentState({ organizationId: ORG, userId: USER, invoiceInstanceId: INVOICE })
    expect(h.listFiltered).not.toHaveBeenCalled()
    expect(writtenValues()).toContainEqual({ fieldId: 'invoice_balance', value: 60 })
  })
})
