// packages/lib/src/postings/effect-types.ts
import { z } from 'zod'

const id = z.string().min(1)
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const minor = z.string().regex(/^(0|[1-9][0-9]*)$/, { abort: true })
const decimal = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/)
const positiveDecimal = decimal.refine((v) => /[1-9]/.test(v), 'Must be positive')
const date = z.iso.date()
const dimensions = z.record(z.string().min(1), z.string().min(1))
const bookTimeZone = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value })
      return true
    } catch {
      return false
    }
  }, 'Unknown book time zone')

function calendarDateInTimeZone(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const fields = new Map(parts.map((part) => [part.type, part.value]))
  return `${fields.get('year')}-${fields.get('month')}-${fields.get('day')}`
}

/** Exact calculation input for the existing fulfillment accounting policy. */
export const fulfillmentAccountingBasisSchema = z
  .strictObject({
    version: z.literal(1),
    fulfillmentInstanceId: id,
    orderInstanceId: id,
    customerInstanceId: id.nullable(),
    sequence: z.number().int().positive(),
    sourceRevision: id,
    sourceHash: hash,
    shippedOn: date,
    channel: z.string().nullable(),
    sourceStoreId: id.nullable(),
    processorRouteId: id.nullable(),
    shippingRegion: z.string().nullable(),
    dimensions,
    lines: z
      .array(
        z.strictObject({
          fulfillmentLineId: id,
          orderLineId: id,
          productInstanceId: id.nullable(),
          sku: z.string().nullable(),
          quantity: positiveDecimal,
          orderedQuantity: positiveDecimal,
          priorShippedQuantity: decimal,
          netUnitMinor: decimal,
          netLineMinor: minor.nullable(),
          lineTaxMinor: minor.nullable(),
        })
      )
      .min(1),
    orderSubtotalMinor: minor,
    orderTaxMinor: minor,
    orderShippingMinor: minor,
    priorShipmentSubtotalMinor: minor,
    shippingAllocationMinor: minor,
    includeShipping: z.boolean(),
    recognitionAllocation: z
      .strictObject({
        amountMinor: minor,
        depositDebitMinor: minor,
        receivableDebitMinor: minor,
        newlyRecognizedTaxMinor: minor,
        historyHash: hash,
      })
      .optional(),
    recognitionHistoryHash: hash.optional(),
    taxComponents: z.array(
      z.strictObject({
        componentKey: id,
        title: z.string(),
        amountMinor: minor,
        jurisdiction: z.string().nullable(),
        collector: z.enum(['merchant', 'marketplace', 'unknown']),
        remitter: z.enum(['merchant', 'marketplace', 'unknown']),
        withholdingEvidenceId: id.nullable(),
      })
    ),
    debitRoute: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('role'),
        role: z.enum(['clearing_card', 'accounts_receivable']),
        reason: id,
      }),
      z.strictObject({ kind: z.literal('account'), glAccountId: id, reason: id }),
    ]),
  })
  .superRefine((value, ctx) => {
    for (const field of ['fulfillmentLineId', 'orderLineId'] as const) {
      if (new Set(value.lines.map((line) => line[field])).size !== value.lines.length) {
        ctx.addIssue({ code: 'custom', message: `Duplicate ${field}` })
      }
    }
  })

/** Durable incomplete evidence is allowed; only ready input can be accepted. */
export const fulfillmentWorkBasisSchema = z
  .discriminatedUnion('status', [
    z.strictObject({
      version: z.literal(1),
      status: z.literal('incomplete'),
      fulfillmentInstanceId: id,
      sourceHash: hash,
      effectiveDate: date.nullable(),
      missingDependencies: z.array(id).min(1),
      observed: z.record(z.string(), z.json()),
    }),
    z.strictObject({
      version: z.literal(1),
      status: z.literal('ready'),
      fulfillmentInstanceId: id,
      sourceHash: hash,
      effectiveDate: date,
      calculation: fulfillmentAccountingBasisSchema,
    }),
  ])
  .superRefine((value, ctx) => {
    if (
      value.status === 'ready' &&
      (value.fulfillmentInstanceId !== value.calculation.fulfillmentInstanceId ||
        value.sourceHash !== value.calculation.sourceHash)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Calculation must match the work source identity and hash',
      })
    }
  })

const contributionSchema = z
  .strictObject({
    lineKey: id,
    glAccountId: id,
    direction: z.enum(['debit', 'credit']),
    amountMinor: minor.refine((v) => BigInt(v) > 0n, 'Contribution must be positive'),
    counterpartyType: z.enum(['customer', 'vendor']).nullable(),
    counterpartyId: id.nullable(),
    dimensions,
  })
  .refine(
    (v) => (v.counterpartyType === null) === (v.counterpartyId === null),
    'Counterparty type and ID must be supplied together'
  )

/** Immutable, independently balanced contribution pinned to one ready work version. */
export const acceptedFulfillmentEffectBasisSchema = z
  .strictObject({
    version: z.literal(1),
    sourceBasisVersion: z.number().int().positive(),
    sourceHash: hash,
    policyKey: z.enum(['fulfillment_current_v1', 'shopify_payment_date_v1']),
    policyVersion: z.literal(1),
    effectiveDate: date,
    bookTimeZone,
    currency: z.literal('USD'),
    currencyExponent: z.literal(2),
    documentRefs: z.array(z.strictObject({ resourceKind: id, entityInstanceId: id })).min(2),
    calculation: fulfillmentAccountingBasisSchema,
    accountResolution: z
      .array(
        z.strictObject({
          lineKey: id,
          glAccountId: id,
          accountRole: id.nullable(),
          selectedBy: z.enum([
            'document',
            'route',
            'source_profile',
            'tax_mapping',
            'org_role',
            'original_effect',
          ]),
          configurationHash: hash,
        })
      )
      .min(2),
    contribution: z.array(contributionSchema).min(2),
  })
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (value.sourceHash !== value.calculation.sourceHash) issue('Calculation source hash differs')
    if (value.calculation.recognitionAllocation && value.policyKey !== 'shopify_payment_date_v1')
      issue('Canonical recognition allocation requires the Shopify payment-date policy')
    if (value.policyKey === 'shopify_payment_date_v1' && !value.calculation.recognitionAllocation)
      issue('Shopify payment-date policy requires a frozen recognition allocation')
    if (
      value.calculation.recognitionAllocation &&
      value.calculation.recognitionHistoryHash !==
        value.calculation.recognitionAllocation.historyHash
    )
      issue('Recognition history hash must match the frozen allocation')
    for (const [kind, entityId] of [
      ['fulfillment', value.calculation.fulfillmentInstanceId],
      ['order', value.calculation.orderInstanceId],
    ]) {
      if (
        !value.documentRefs.some((r) => r.resourceKind === kind && r.entityInstanceId === entityId)
      )
        issue(`Missing ${kind} source reference`)
    }
    const keys = value.contribution.map((line) => line.lineKey)
    if (new Set(keys).size !== keys.length) issue('Duplicate contribution line key')
    const resolutions = new Map(value.accountResolution.map((line) => [line.lineKey, line]))
    if (resolutions.size !== value.accountResolution.length || resolutions.size !== keys.length)
      issue('Account resolution must match contribution exactly')
    let balance = 0n
    let debit = 0n
    for (const line of value.contribution) {
      const amount = BigInt(line.amountMinor)
      balance += line.direction === 'debit' ? amount : -amount
      if (line.direction === 'debit') debit += amount
      if (resolutions.get(line.lineKey)?.glAccountId !== line.glAccountId)
        issue('Resolved account differs from contribution')
      if (amount > BigInt(Number.MAX_SAFE_INTEGER))
        issue('Amount exceeds the current ledger safe-number boundary')
    }
    if (balance !== 0n) issue('Effect contribution must balance independently')
    if (debit > BigInt(Number.MAX_SAFE_INTEGER))
      issue('Effect total exceeds the current ledger safe-number boundary')
  })

export type FulfillmentAccountingBasisV1 = z.infer<typeof fulfillmentAccountingBasisSchema>
export type AcceptedFulfillmentEffectBasisV1 = z.infer<typeof acceptedFulfillmentEffectBasisSchema>

/** Exact order/payment facts frozen for one confirmed customer receipt. */
export const customerReceiptAccountingBasisSchema = z
  .strictObject({
    version: z.literal(1),
    moneyTransactionId: id,
    orderInstanceId: id,
    sourceObjectId: id.nullable(),
    sourceExternalId: z.string().nullable(),
    sourceRevision: id,
    sourceHash: hash,
    historyHash: hash,
    occurredAt: z.iso.datetime(),
    effectiveDate: date,
    currency: z.literal('USD'),
    currencyExponent: z.literal(2),
    amountMinor: minor.refine((v) => BigInt(v) > 0n, 'Receipt must be positive'),
    orderSubtotalMinor: minor,
    orderTaxMinor: minor,
    orderShippingMinor: minor,
    orderTotalMinor: minor,
    receiptAmountMinor: minor.refine((v) => BigInt(v) > 0n, 'Receipt must be positive'),
    receivableMinor: minor,
    depositMinor: minor,
    taxMinor: minor,
    allocation: z.strictObject({
      amountMinor: minor,
      depositMinor: minor,
      receivableMinor: minor,
      taxMinor: minor,
    }),
    paymentRouteId: id,
    sourceStoreId: id,
    processorAccountId: id,
    route: z.strictObject({
      paymentRouteId: id,
      processorAccountId: id,
      glAccountId: id,
      reason: id,
    }),
    applications: z
      .array(
        z.strictObject({
          applicationId: id,
          orderInstanceId: id,
          amountMinor: minor.refine((v) => BigInt(v) > 0n, 'Application must be positive'),
          effectiveDate: date,
        })
      )
      .min(1),
    taxComponents: z.array(
      z.strictObject({
        componentKey: id,
        amountMinor: minor,
        jurisdiction: z.string().nullable(),
        collector: z.enum(['merchant', 'marketplace', 'unknown']),
        remitter: z.enum(['merchant', 'marketplace', 'unknown']),
        withholdingEvidenceId: id.nullable(),
      })
    ),
  })
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (value.receiptAmountMinor !== value.amountMinor)
      issue('Receipt amount must equal the confirmed money transaction amount')
    if (
      BigInt(value.orderTotalMinor) !==
      BigInt(value.orderSubtotalMinor) +
        BigInt(value.orderTaxMinor) +
        BigInt(value.orderShippingMinor)
    )
      issue('Order totals do not add to the order total')
    if (
      BigInt(value.receivableMinor) + BigInt(value.depositMinor) + BigInt(value.taxMinor) !==
      BigInt(value.receiptAmountMinor)
    )
      issue('Receipt contribution does not balance its amount')
    if (
      value.allocation.amountMinor !== value.receiptAmountMinor ||
      value.allocation.depositMinor !== value.depositMinor ||
      value.allocation.receivableMinor !== value.receivableMinor ||
      value.allocation.taxMinor !== value.taxMinor
    )
      issue('Recognition allocation does not equal receipt contribution')
    if (value.route.paymentRouteId !== value.paymentRouteId)
      issue('Receipt route identity differs from the calculation payment route')
    if (value.route.processorAccountId !== value.processorAccountId)
      issue('Receipt processor account differs from the calculation processor account')
    const applicationTotal = value.applications.reduce(
      (sum, item) => sum + BigInt(item.amountMinor),
      0n
    )
    if (applicationTotal !== BigInt(value.receiptAmountMinor))
      issue('Receipt applications do not equal the receipt amount')
    if (
      value.applications.some(
        (item) =>
          item.orderInstanceId !== value.orderInstanceId ||
          item.effectiveDate !== value.effectiveDate
      )
    )
      issue('Receipt applications must match the frozen order and accounting date')
    const taxTotal = value.taxComponents.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n)
    if (taxTotal !== BigInt(value.taxMinor)) issue('Tax components do not equal collected tax')
  })

export const customerReceiptWorkBasisSchema = z
  .discriminatedUnion('status', [
    z.strictObject({
      version: z.literal(1),
      status: z.literal('incomplete'),
      moneyTransactionId: id,
      sourceHash: hash,
      effectiveDate: date.nullable(),
      missingDependencies: z.array(id).min(1),
      observed: z.record(z.string(), z.json()),
    }),
    z.strictObject({
      version: z.literal(1),
      status: z.literal('ready'),
      moneyTransactionId: id,
      sourceHash: hash,
      effectiveDate: date,
      calculation: customerReceiptAccountingBasisSchema,
    }),
  ])
  .superRefine((value, ctx) => {
    if (value.status !== 'ready') return
    if (value.moneyTransactionId !== value.calculation.moneyTransactionId)
      ctx.addIssue({ code: 'custom', message: 'Receipt work owner differs from its calculation' })
    if (value.sourceHash !== value.calculation.sourceHash)
      ctx.addIssue({ code: 'custom', message: 'Receipt work hash differs from its calculation' })
    if (value.effectiveDate !== value.calculation.effectiveDate)
      ctx.addIssue({ code: 'custom', message: 'Receipt work date differs from its calculation' })
  })

export const acceptedCustomerReceiptEffectBasisSchema = z
  .strictObject({
    version: z.literal(1),
    sourceBasisVersion: z.number().int().positive(),
    sourceHash: hash,
    policyKey: z.literal('shopify_receipt_v1'),
    policyVersion: z.literal(1),
    effectiveDate: date,
    bookTimeZone,
    currency: z.literal('USD'),
    currencyExponent: z.literal(2),
    documentRefs: z.array(z.strictObject({ resourceKind: id, entityInstanceId: id })).min(1),
    calculation: customerReceiptAccountingBasisSchema,
    accountResolution: z
      .array(
        z.strictObject({
          lineKey: id,
          glAccountId: id,
          accountRole: id.nullable(),
          selectedBy: z.enum([
            'document',
            'route',
            'source_profile',
            'tax_mapping',
            'org_role',
            'original_effect',
          ]),
          configurationHash: hash,
        })
      )
      .min(2),
    contribution: z.array(contributionSchema).min(2),
  })
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (value.sourceHash !== value.calculation.sourceHash) issue('Calculation source hash differs')
    if (value.effectiveDate !== value.calculation.effectiveDate)
      issue('Receipt effect date differs from its calculation date')
    if (
      calendarDateInTimeZone(value.calculation.occurredAt, value.bookTimeZone) !==
      value.effectiveDate
    )
      issue('Receipt effect date differs from the occurrence date in the book time zone')
    if (
      !value.documentRefs.some(
        (r) =>
          r.resourceKind === 'order' && r.entityInstanceId === value.calculation.orderInstanceId
      )
    )
      issue('Missing order source reference')
    if (
      !value.documentRefs.some(
        (r) =>
          r.resourceKind === 'money_transaction' &&
          r.entityInstanceId === value.calculation.moneyTransactionId
      )
    )
      issue('Missing money transaction source reference')
    const keys = value.contribution.map((line) => line.lineKey)
    if (new Set(keys).size !== keys.length) issue('Duplicate contribution line key')
    const resolutions = new Map(value.accountResolution.map((line) => [line.lineKey, line]))
    if (resolutions.size !== value.accountResolution.length || resolutions.size !== keys.length)
      issue('Account resolution must match contribution exactly')
    let balance = 0n
    let debit = 0n
    for (const line of value.contribution) {
      const amount = BigInt(line.amountMinor)
      if (line.direction === 'debit') {
        balance += amount
        debit += amount
      } else {
        balance -= amount
      }
      if (amount > BigInt(Number.MAX_SAFE_INTEGER))
        issue('Amount exceeds ledger safe-number boundary')
      if (resolutions.get(line.lineKey)?.glAccountId !== line.glAccountId)
        issue('Resolved account differs from contribution')
    }
    if (balance !== 0n) issue('Effect contribution must balance independently')
    if (debit > BigInt(Number.MAX_SAFE_INTEGER))
      issue('Effect total exceeds the current ledger safe-number boundary')
    if (
      !value.contribution.some(
        (line) =>
          line.direction === 'debit' && line.glAccountId === value.calculation.route.glAccountId
      )
    )
      issue('Receipt route account must be the debit account')
    const routeDebit = value.contribution.reduce(
      (sum, line) =>
        line.direction === 'debit' && line.glAccountId === value.calculation.route.glAccountId
          ? sum + BigInt(line.amountMinor)
          : sum,
      0n
    )
    if (routeDebit !== BigInt(value.calculation.amountMinor))
      issue('Receipt route debit must equal the receipt amount')
    if (debit !== BigInt(value.calculation.amountMinor))
      issue('Receipt total debit must equal the receipt amount')
  })

export type CustomerReceiptAccountingBasisV1 = z.infer<typeof customerReceiptAccountingBasisSchema>
export type CustomerReceiptWorkBasisInput = z.infer<typeof customerReceiptWorkBasisSchema>
/** Existing fulfillment work input; retained for callers that only accept fulfillments. */
export const accountingWorkBasisSchema = fulfillmentWorkBasisSchema
/** Work input for either the fulfillment or receipt owner. */
export const accountingWorkBasisSchemaV1 = z.union([
  fulfillmentWorkBasisSchema,
  customerReceiptWorkBasisSchema,
])
export type AccountingWorkBasisInput = z.infer<typeof accountingWorkBasisSchema>
export type AccountingWorkBasisInputV1 = z.infer<typeof accountingWorkBasisSchemaV1>
export type AcceptedCustomerReceiptEffectBasisV1 = z.infer<
  typeof acceptedCustomerReceiptEffectBasisSchema
>
export type AcceptedAccountingEffectBasisV1 =
  | AcceptedFulfillmentEffectBasisV1
  | AcceptedCustomerReceiptEffectBasisV1
