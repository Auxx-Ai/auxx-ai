// packages/lib/src/postings/document-effect-types.ts

/**
 * The effect contract for the DOCUMENT-driven accounting families — D19 of
 * plans/accounting/tasks/53-two-modes-one-ledger.md §7.3.3.
 *
 * ## Why one contract instead of six
 *
 * The four families that already have effects — `fulfillment_accounting`,
 * `customer_receipt`, `customer_credit_issued`, `customer_refund` — each own a
 * bespoke calculation schema because each freezes real arithmetic: a
 * recognition allocation, a tax-component split, a per-source allocation table.
 * Reading one of those calculations tells you HOW the number was reached, and
 * that is the point of freezing it.
 *
 * The D19 families do not have that arithmetic. Every one of them is a pure
 * builder over a handful of scalars transcribed off one document —
 * `build-invoice-entry.ts` derives revenue as `total - tax` and refuses to
 * recompute the discount; `build-expense-bill-entry.ts` transcribes
 * `vendor_bill_total` and never computes it; `build-payout-entry.ts` takes
 * gross, fees and net as given. Six near-identical schemas over
 * `{ documentId, number, date, amounts }` would be six places for the same
 * balance rule to drift.
 *
 * So the calculation here is the document's identity plus the exact ENTRY LINES
 * its builder produced, and {@link acceptedDocumentEffectBasisSchema} asserts
 * that the accepted contribution is those lines with their accounts resolved —
 * same keys, same directions, same amounts. That is the "the entry ties to the
 * document by construction" property `build-invoice-entry.ts` argues for,
 * expressed as a schema rather than as a comment.
 *
 * ## 🛑 What is NOT in here, and why
 *
 * `deposit_application` is one of D19's seven and is deliberately absent — not
 * because it has no home, but because it is not a DOCUMENT family. Its owner is
 * a `MoneyApplication`: the money is the subject and the invoice is a reference,
 * which is the opposite of every family here. It is money-owned work under
 * `postings/application-effect-types.ts` (`money_application_v1`).
 *
 * @see plans/accounting/tasks/44-money-and-accounting-effect-contracts.md
 */

import { z } from 'zod'
import { reservedAccountingBasis } from './basis-dimension'

const id = z.string().min(1)
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const minor = z.string().regex(/^(0|[1-9][0-9]*)$/)
const positiveMinor = minor.refine((value) => BigInt(value) > 0n, 'Amount must be positive')
const date = z.iso.date()
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

/** The document-driven accounting families D19 opened. */
export const DOCUMENT_EFFECT_FAMILIES = [
  'invoice_issued',
  'invoice_write_off',
  'payout_settlement',
  'expense_bill',
  'vendor_bill_matched',
  'inventory_receipt',
] as const

export const documentEffectFamilySchema = z.enum(DOCUMENT_EFFECT_FAMILIES)
export type DocumentEffectFamily = z.infer<typeof documentEffectFamilySchema>

/**
 * What each family owns, posts and refers to.
 *
 * 🔑 `effectKind` is intentionally the family name. Two families may share an
 * owner (`invoice_issued` and `invoice_write_off` on one invoice; `expense_bill`
 * and `vendor_bill_matched` on one bill) precisely because the kind is part of
 * every key the table enforces.
 *
 * ## 🛑 `repeatable` is the one axis that is not cosmetic
 *
 * Five of these six are one journal per document, forever, and
 * `AccountingWork_fulfillment_original_key` — the partial unique on
 * `(organizationId, entityInstanceId, effectKind)` for `operation = 'original'` —
 * is narrowed to exactly those five.
 *
 * `invoice_write_off` is the exception and it is a real one: a partial write-off
 * can be topped up months later, `build-write-off-entry.ts` already carries an
 * ATTEMPT in its `periodKey` for that reason, and a July write-off after a March
 * one is NEW bad debt on its own date — not `operation: 'correction'`, which
 * would claim the March entry was a mistake and misstate the month the loss
 * happened. A repeatable family passes an `occurrence` to
 * {@link documentAccountingEffectKey}, and `AccountingWork_org_effect_key` is
 * what keeps it honest.
 *
 * ⚠️ `postingType` is NOT always the family name: the write-off family posts
 * `write_off`, the settlement family posts `payout`, and the goods-receipt
 * family posts `receipt`. The enum values were named for the journal; the
 * families are named for the document.
 */
export const DOCUMENT_EFFECT_FAMILY_SPEC = {
  invoice_issued: {
    entityType: 'invoice',
    resourceKind: 'invoice',
    postingType: 'invoice_issued',
    repeatable: false,
  },
  invoice_write_off: {
    entityType: 'invoice',
    resourceKind: 'invoice',
    postingType: 'write_off',
    repeatable: true,
  },
  payout_settlement: {
    entityType: 'payout',
    resourceKind: 'payout',
    postingType: 'payout',
    repeatable: false,
  },
  expense_bill: {
    entityType: 'vendor_bill',
    resourceKind: 'vendor_bill',
    postingType: 'expense_bill',
    repeatable: false,
  },
  vendor_bill_matched: {
    entityType: 'vendor_bill',
    resourceKind: 'vendor_bill',
    postingType: 'vendor_bill',
    repeatable: false,
  },
  inventory_receipt: {
    entityType: 'stock_movement',
    resourceKind: 'stock_movement',
    postingType: 'receipt',
    repeatable: false,
  },
} as const satisfies Record<
  DocumentEffectFamily,
  { entityType: string; resourceKind: string; postingType: string; repeatable: boolean }
>

/** The `GlPostingType` a document family claims. */
export type DocumentEffectPostingType =
  (typeof DOCUMENT_EFFECT_FAMILY_SPEC)[DocumentEffectFamily]['postingType']

/** True when this `AccountingWork.effectKind` is a D19 document family. */
export function isDocumentEffectFamily(kind: string): kind is DocumentEffectFamily {
  return (DOCUMENT_EFFECT_FAMILIES as readonly string[]).includes(kind)
}

/**
 * One line of the document's entry, BEFORE account resolution.
 *
 * Exactly one of `accountRole` and `glAccountId` is set, which is the same
 * either/or every one of these builders already emits: a role when the org
 * chart answers (`accounts_receivable`, `revenue_service`), an id when the
 * document itself named the account (a coded expense-bill line, a payout's
 * resolved bank account).
 */
const documentLineSchema = z
  .strictObject({
    lineKey: id,
    accountRole: id.nullable(),
    glAccountId: id.nullable(),
    direction: z.enum(['debit', 'credit']),
    amountMinor: positiveMinor,
    counterpartyType: z.enum(['customer', 'vendor']).nullable(),
    counterpartyId: id.nullable(),
    dimensions: z.record(z.string().min(1), z.string().min(1)),
  })
  .refine(
    (line) => (line.accountRole === null) !== (line.glAccountId === null),
    'A document line names either an account role or an account id, never both and never neither'
  )
  .refine(
    (line) => (line.counterpartyType === null) === (line.counterpartyId === null),
    'Counterparty type and ID must be supplied together'
  )

/** The exact document facts and entry lines frozen for one document-driven journal. */
export const documentAccountingBasisSchema = z
  .strictObject({
    version: z.literal(1),
    family: documentEffectFamilySchema,
    /** The owning `EntityInstance` — an invoice, a payout, a vendor bill, a stock movement. */
    documentInstanceId: id,
    /**
     * The document's own short human key, and the journal's `periodKey`.
     *
     * 🔑 Kept rather than replaced by an acceptance grouping hash. The document
     * number is both a stronger claim key and a readable one — `AUXX-INI-INV-0042`
     * instead of `AUXX-INI-g1a2b3c4d`. `acceptEntryInTx` honours it.
     *
     * 🛑 On a `repeatable` family this is also where the OCCURRENCE is pinned:
     * `writeOffPeriodKey` appends the attempt, so `acceptEntryInTx`'s
     * `documentKey === entry.periodKey` check ties the frozen basis to the exact
     * write-off it belongs to and not merely to the invoice.
     */
    documentKey: id,
    sourceHash: hash,
    effectiveDate: date,
    currency: z.literal('USD'),
    currencyExponent: z.literal(2),
    /** Total debit. The receivable raised, the bill accrued, the payout settled. */
    totalMinor: positiveMinor,
    /**
     * Task 47 §5 role scope, in exactly the vocabulary `resolveRoles` reads.
     *
     * 🛑 The three states are distinct and `accept-entry.ts`'s `effectRoleScope`
     * depends on all three. ABSENT is "this family has no source axis" and
     * resolves to the org default. `null` on `sourceStoreId` is "there was no
     * CONNECTED source", which routes to the manual source's override. A string
     * is the source's own id.
     *
     * ⚠️ Preparation must resolve through {@link documentRoleScope} so it uses
     * the identical scope acceptance will re-resolve through — otherwise a
     * scoped org reports "an account role changed after preparation" on a change
     * nobody made.
     */
    sourceStoreId: id.nullable().optional(),
    processorAccountId: id.optional(),
    lines: z.array(documentLineSchema).min(2),
  })
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    const keys = value.lines.map((line) => line.lineKey)
    if (new Set(keys).size !== keys.length) issue('Duplicate document line key')
    let balance = 0n
    let debit = 0n
    for (const line of value.lines) {
      const amount = BigInt(line.amountMinor)
      balance += line.direction === 'debit' ? amount : -amount
      if (line.direction === 'debit') debit += amount
      if (amount > BigInt(Number.MAX_SAFE_INTEGER))
        issue('Amount exceeds the current ledger safe-number boundary')
    }
    if (balance !== 0n) issue('Document lines must balance independently')
    if (debit !== BigInt(value.totalMinor)) issue('Document lines do not equal the document total')
  })

/** Durable incomplete evidence is allowed; only ready input can be accepted. */
export const documentWorkBasisSchema = z
  .discriminatedUnion('status', [
    z.strictObject({
      version: z.literal(1),
      status: z.literal('incomplete'),
      family: documentEffectFamilySchema,
      documentInstanceId: id,
      sourceHash: hash,
      effectiveDate: date.nullable(),
      missingDependencies: z.array(id).min(1),
      observed: z.record(z.string(), z.json()),
    }),
    z.strictObject({
      version: z.literal(1),
      status: z.literal('ready'),
      family: documentEffectFamilySchema,
      documentInstanceId: id,
      sourceHash: hash,
      effectiveDate: date,
      calculation: documentAccountingBasisSchema,
    }),
  ])
  .superRefine((value, ctx) => {
    if (value.status !== 'ready') return
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (value.family !== value.calculation.family) issue('Document work family differs')
    if (value.documentInstanceId !== value.calculation.documentInstanceId)
      issue('Document work owner differs from its calculation')
    if (value.sourceHash !== value.calculation.sourceHash)
      issue('Document work hash differs from its calculation')
    if (value.effectiveDate !== value.calculation.effectiveDate)
      issue('Document work date differs from its calculation')
  })

const contributionSchema = z
  .strictObject({
    lineKey: id,
    glAccountId: id,
    direction: z.enum(['debit', 'credit']),
    amountMinor: positiveMinor,
    counterpartyType: z.enum(['customer', 'vendor']).nullable(),
    counterpartyId: id.nullable(),
    dimensions: z.record(z.string().min(1), z.string().min(1)),
  })
  .refine(
    (value) => (value.counterpartyType === null) === (value.counterpartyId === null),
    'Counterparty type and ID must be supplied together'
  )

const accountResolutionSchema = z.strictObject({
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

/**
 * Immutable, independently balanced contribution pinned to one ready document
 * work version.
 *
 * 🔑 The load-bearing check is the last one: the accepted contribution must be
 * the frozen document lines with their accounts resolved — same keys, same
 * directions, same amounts, same counterparties. An accepted effect that drifts
 * from the document it names is the failure this contract exists to make
 * impossible.
 */
export const acceptedDocumentEffectBasisSchema = z
  .strictObject({
    version: z.literal(1),
    sourceBasisVersion: z.number().int().positive(),
    sourceHash: hash,
    policyKey: z.literal('document_entry_v1'),
    policyVersion: z.literal(1),
    /** Reserved (D13). Absent everywhere today; see `basis-dimension.ts`. */
    basis: reservedAccountingBasis,
    effectiveDate: date,
    bookTimeZone,
    currency: z.literal('USD'),
    currencyExponent: z.literal(2),
    documentRefs: z.array(z.strictObject({ resourceKind: id, entityInstanceId: id })).min(1),
    calculation: documentAccountingBasisSchema,
    accountResolution: z.array(accountResolutionSchema).min(2),
    contribution: z.array(contributionSchema).min(2),
  })
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (value.sourceHash !== value.calculation.sourceHash) issue('Calculation source hash differs')
    if (value.effectiveDate !== value.calculation.effectiveDate)
      issue('Document effect date differs from its calculation date')
    const spec = DOCUMENT_EFFECT_FAMILY_SPEC[value.calculation.family]
    if (
      !value.documentRefs.some(
        (ref) =>
          ref.resourceKind === spec.resourceKind &&
          ref.entityInstanceId === value.calculation.documentInstanceId
      )
    )
      issue(`Missing ${spec.resourceKind} source reference`)

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
    if (debit !== BigInt(value.calculation.totalMinor))
      issue('Effect debit total must equal the document total')

    const documentLines = new Map(value.calculation.lines.map((line) => [line.lineKey, line]))
    if (documentLines.size !== value.contribution.length)
      issue('Contribution must carry exactly one line per document line')
    for (const line of value.contribution) {
      const source = documentLines.get(line.lineKey)
      if (!source) {
        issue(`Contribution line ${line.lineKey} is not a line of this document`)
        continue
      }
      if (
        source.direction !== line.direction ||
        source.amountMinor !== line.amountMinor ||
        source.counterpartyType !== line.counterpartyType ||
        source.counterpartyId !== line.counterpartyId
      )
        issue(`Contribution line ${line.lineKey} differs from the document line it names`)
      const resolution = resolutions.get(line.lineKey)
      if (source.glAccountId !== null && source.glAccountId !== line.glAccountId)
        issue(`Contribution line ${line.lineKey} left the account its document named`)
      if (source.accountRole !== null && resolution?.accountRole !== source.accountRole)
        issue(`Contribution line ${line.lineKey} left the account role its document named`)
    }
  })

/**
 * The role scope one document's calculation resolves through.
 *
 * 🔑 Byte-for-byte what `accept-entry.ts`'s `effectRoleScope` derives from the
 * same calculation. Preparation calls this so the two cannot drift; if they
 * drift, every scoped org gets a refusal describing a change nobody made.
 */
export function documentRoleScope(calculation: {
  sourceStoreId?: string | null
  processorAccountId?: string
}): { store?: string | null; rail?: string } {
  return {
    ...(calculation.sourceStoreId === undefined ? {} : { store: calculation.sourceStoreId }),
    ...(typeof calculation.processorAccountId === 'string'
      ? { rail: calculation.processorAccountId }
      : {}),
  }
}

export type DocumentAccountingBasisV1 = z.infer<typeof documentAccountingBasisSchema>
export type DocumentWorkBasisInput = z.infer<typeof documentWorkBasisSchema>
export type AcceptedDocumentEffectBasisV1 = z.infer<typeof acceptedDocumentEffectBasisSchema>
