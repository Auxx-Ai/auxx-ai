// packages/lib/src/postings/effect-types.ts
import { dayKeyInZone } from '@auxx/utils/calendar-day'
import { z } from 'zod'
import {
  type AcceptedMoneyApplicationEffectBasisV1,
  moneyApplicationWorkBasisSchema,
} from './application-effect-types'
import { reservedAccountingBasis } from './basis-dimension'
import {
  type AcceptedCustomerCreditEffectBasisV1,
  customerCreditWorkBasisSchema,
} from './credit-effect-types'
import {
  type AcceptedDocumentEffectBasisV1,
  documentWorkBasisSchema,
} from './document-effect-types'
import {
  type AcceptedCustomerRefundEffectBasisV1,
  customerRefundWorkBasisSchema,
} from './refund-effect-types'

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
    /** The `payment_gateway` record this shipment's card half settles through (58 §5.2). */
    paymentGatewayId: id.nullable(),
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
    // 🛑 A ROLE, never an account id: since 58 U3 the rail's clearing account is
    // named by a `GlRoleAssignment` row, so there is nothing left to pin by id.
    debitRoute: z.strictObject({
      kind: z.literal('role'),
      role: z.enum(['clearing', 'accounts_receivable', 'undeposited_funds']),
      reason: id,
    }),
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
    /** Reserved (D13). Absent everywhere today; see `basis-dimension.ts`. */
    basis: reservedAccountingBasis,
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
    /** The `payment_gateway` record the receipt's rail scope resolves through (58 §5.6). */
    paymentGatewayId: id,
    sourceStoreId: id,
    route: z.strictObject({
      paymentGatewayId: id,
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
    if (value.route.paymentGatewayId !== value.paymentGatewayId)
      issue('Receipt route identity differs from the calculation payment gateway')
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

/**
 * Exact invoice facts frozen for one confirmed receipt against an INVOICE.
 *
 * The second policy under the `customer_receipt` family (task 54 §7). The
 * schema above is the Shopify-order policy and stays byte-identical, because
 * `credit-memos/accounting.ts` and `customer-money/refund-accounting.ts`
 * re-parse frozen bases that were written against it.
 *
 * ## 🔑 Why this one is so much smaller
 *
 * `buildInvoiceEntry` already booked `Dr accounts_receivable / Cr revenue /
 * Cr sales_tax_payable` when the invoice was issued, so a receipt against it
 * recognizes nothing — it is `Dr <cash> / Cr accounts_receivable` and no more.
 * There is no recognition timeline to allocate against, no tax to split, and no
 * deposit half: money received against an issued invoice was always owed. The
 * order policy needs all of that because a Shopify receipt can arrive before
 * anything has been recognized.
 *
 * ## ⚠️ `kind` is what makes the union unambiguous
 *
 * Both members are `strictObject`s, so the discriminator is structural: an
 * order basis has no `kind` and is rejected here, and an invoice basis's `kind`
 * is an unknown key up there. Do not remove it, and do not add it to the order
 * schema — that would rewrite the meaning of 432 frozen, sha256-hashed rows.
 */
export const invoiceReceiptAccountingBasisSchema = z
  .strictObject({
    version: z.literal(1),
    kind: z.literal('invoice_receipt'),
    moneyTransactionId: id,
    invoiceInstanceId: id,
    sourceHash: hash,
    /**
     * ⚠️ **Both precisions, mirroring `MoneyTransaction`'s own CHECK.** A
     * Shopify receipt has an instant; a cheque someone recorded as "the 3rd"
     * has a DATE and nothing more, and inventing a time for it would make the
     * book date depend on a timezone conversion of a fact nobody observed.
     * Exactly one of these is set.
     */
    occurredAt: z.iso.datetime().nullable(),
    occurredOn: date.nullable(),
    effectiveDate: date,
    currency: z.literal('USD'),
    currencyExponent: z.literal(2),
    amountMinor: minor.refine((v) => BigInt(v) > 0n, 'Receipt must be positive'),
    receiptAmountMinor: minor.refine((v) => BigInt(v) > 0n, 'Receipt must be positive'),
    /** The invoice total as `invoice_total` stood when the receipt was frozen. */
    invoiceTotalMinor: minor,
    /** What the invoice still owed BEFORE this receipt. The receipt may not exceed it. */
    invoiceOutstandingMinor: minor,
    /** The whole receipt relieves the receivable; kept explicit so the entry reads off the basis. */
    receivableMinor: minor,
    /**
     * The resolved debit account, whichever way it was chosen. Frozen because a
     * chart repointed later must not restate an approved obligation.
     */
    cashGlAccountId: id,
    /**
     * 🔑 **How the debit account was chosen, and it is genuinely two ways.**
     *
     * `bank_account` — the payer named where the money landed, so the account
     * is that `bank_account` record's `bank_account_gl_account` pointer.
     *
     * `undeposited_funds` — nobody named one, so the money sits in the
     * {@link ACCOUNT_ROLES.UNDEPOSITED_FUNDS} role until a `bank_deposit`
     * groups it and posts the single `Dr cash Cr undeposited_funds` line.
     *
     * ⚠️ This is not a default-vs-explicit distinction, it is an accounting
     * one. `bank-deposits/route.ts` routes cash and cheque to undeposited funds
     * precisely because five cheques banked together arrive as ONE bank line
     * that five separate cash postings can never match. Debiting a bank account
     * directly for them balances and silently breaks bank matching.
     */
    debitSelectedBy: z.enum(['bank_account', 'undeposited_funds']),
    /** The `bank_account` record, when one was named. Null for undeposited funds. */
    bankAccountInstanceId: id.nullable(),
    applications: z
      .array(
        z.strictObject({
          applicationId: id,
          invoiceInstanceId: id,
          amountMinor: minor.refine((v) => BigInt(v) > 0n, 'Application must be positive'),
          effectiveDate: date,
        })
      )
      .min(1),
  })
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (value.receiptAmountMinor !== value.amountMinor)
      issue('Receipt amount must equal the confirmed money transaction amount')
    if (value.receivableMinor !== value.receiptAmountMinor)
      issue('An invoice receipt relieves the receivable by its whole amount')
    if (BigInt(value.receiptAmountMinor) > BigInt(value.invoiceOutstandingMinor))
      issue('Receipt exceeds what the invoice still owed')
    if (BigInt(value.invoiceOutstandingMinor) > BigInt(value.invoiceTotalMinor))
      issue('Invoice outstanding exceeds its total')
    const applicationTotal = value.applications.reduce(
      (sum, item) => sum + BigInt(item.amountMinor),
      0n
    )
    if (applicationTotal !== BigInt(value.receiptAmountMinor))
      issue('Receipt applications do not equal the receipt amount')
    if (
      value.applications.some(
        (item) =>
          item.invoiceInstanceId !== value.invoiceInstanceId ||
          item.effectiveDate !== value.effectiveDate
      )
    )
      issue('Receipt applications must match the frozen invoice and accounting date')
    if ((value.debitSelectedBy === 'bank_account') !== (value.bankAccountInstanceId !== null))
      issue('A bank-account receipt names its bank account; an undeposited one names none')
    if ((value.occurredAt === null) === (value.occurredOn === null))
      issue('A receipt occurred at an instant or on a date, never both or neither')
    // A date-precision receipt IS its book date. There is no conversion to do,
    // so there is nothing for the timezone check on the accepted basis to
    // verify — it is pinned here instead.
    if (value.occurredOn !== null && value.occurredOn !== value.effectiveDate)
      issue('A date-precision receipt books on the day it occurred')
  })

/** Either receipt policy's frozen calculation. Order first — it is the older shape. */
export const customerReceiptCalculationSchema = z.union([
  customerReceiptAccountingBasisSchema,
  invoiceReceiptAccountingBasisSchema,
])

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
      calculation: customerReceiptCalculationSchema,
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
    /** `invoice_receipt_v1` is task 54's second policy; the family is unchanged. */
    policyKey: z.enum(['shopify_receipt_v1', 'invoice_receipt_v1']),
    policyVersion: z.literal(1),
    /** Reserved (D13). Absent everywhere today; see `basis-dimension.ts`. */
    basis: reservedAccountingBasis,
    effectiveDate: date,
    bookTimeZone,
    currency: z.literal('USD'),
    currencyExponent: z.literal(2),
    documentRefs: z.array(z.strictObject({ resourceKind: id, entityInstanceId: id })).min(1),
    calculation: customerReceiptCalculationSchema,
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
    // Only an INSTANT needs converting into the book's day. A date-precision
    // receipt already is one, and its own schema pins it to `effectiveDate`.
    if (
      value.calculation.occurredAt !== null &&
      dayKeyInZone(new Date(value.calculation.occurredAt), value.bookTimeZone) !==
        value.effectiveDate
    )
      issue('Receipt effect date differs from the occurrence date in the book time zone')
    // The two policies name different source documents, and each one's ref has
    // to be present or the register cannot get back from an effect to what it
    // was about. `kind` is the structural discriminator; see the invoice basis.
    const invoicePolicy = 'kind' in value.calculation
    if (invoicePolicy !== (value.policyKey === 'invoice_receipt_v1'))
      issue('Receipt policy key does not match its calculation shape')
    if (
      !invoicePolicy &&
      !value.documentRefs.some(
        (r) =>
          r.resourceKind === 'order' &&
          !('kind' in value.calculation) &&
          r.entityInstanceId === value.calculation.orderInstanceId
      )
    )
      issue('Missing order source reference')
    if (
      invoicePolicy &&
      !value.documentRefs.some(
        (r) =>
          r.resourceKind === 'invoice' &&
          'kind' in value.calculation &&
          r.entityInstanceId === value.calculation.invoiceInstanceId
      )
    )
      issue('Missing invoice source reference')
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
    // Where the money landed: the frozen clearing route for an order receipt,
    // the resolved cash account for an invoice one. Either way the account must
    // move by the WHOLE receipt.
    //
    // 🛑 **Direction is deliberately not asserted here, and this is subtle.**
    // A CORRECTION of a receipt is the original with its signs flipped, so cash
    // is its credit side. Pinning cash to the debit side in the schema made
    // every correction unrepresentable — which is why, at 9,102 accepted
    // effects, not one of them was `operation: 'correction'`.
    //
    // ✅ Nothing is lost. `accept-entry.ts` knows `work.operation`, which the
    // schema never can, and asserts the stronger pair there: an ORIGINAL debits
    // cash, and a CORRECTION is the exact negation of the effect it corrects.
    const cashGlAccountId =
      'kind' in value.calculation
        ? value.calculation.cashGlAccountId
        : value.calculation.route.glAccountId
    const cashMovement = value.contribution.reduce(
      (sum, line) => (line.glAccountId === cashGlAccountId ? sum + BigInt(line.amountMinor) : sum),
      0n
    )
    if (cashMovement !== BigInt(value.calculation.amountMinor))
      issue('Receipt cash account must move by the receipt amount')
    if (debit !== BigInt(value.calculation.amountMinor))
      issue('Receipt total debit must equal the receipt amount')
  })

export type CustomerReceiptAccountingBasisV1 = z.infer<typeof customerReceiptAccountingBasisSchema>
export type InvoiceReceiptAccountingBasisV1 = z.infer<typeof invoiceReceiptAccountingBasisSchema>
/** Either receipt policy's calculation; narrow with `'kind' in calculation`. */
export type CustomerReceiptCalculationV1 = z.infer<typeof customerReceiptCalculationSchema>
export type CustomerReceiptWorkBasisInput = z.infer<typeof customerReceiptWorkBasisSchema>
/** Existing fulfillment work input; retained for callers that only accept fulfillments. */
export const accountingWorkBasisSchema = fulfillmentWorkBasisSchema
/** Work input for either the fulfillment or receipt owner. */
export const accountingWorkBasisSchemaV1 = z.union([
  fulfillmentWorkBasisSchema,
  customerReceiptWorkBasisSchema,
  customerCreditWorkBasisSchema,
  customerRefundWorkBasisSchema,
  documentWorkBasisSchema,
  moneyApplicationWorkBasisSchema,
])
export type AccountingWorkBasisInput = z.infer<typeof accountingWorkBasisSchema>
export type AccountingWorkBasisInputV1 = z.infer<typeof accountingWorkBasisSchemaV1>
export type AcceptedCustomerReceiptEffectBasisV1 = z.infer<
  typeof acceptedCustomerReceiptEffectBasisSchema
>
export type AcceptedAccountingEffectBasisV1 =
  | AcceptedFulfillmentEffectBasisV1
  | AcceptedCustomerReceiptEffectBasisV1
  | AcceptedCustomerCreditEffectBasisV1
  | AcceptedCustomerRefundEffectBasisV1
  | AcceptedDocumentEffectBasisV1
  | AcceptedMoneyApplicationEffectBasisV1
