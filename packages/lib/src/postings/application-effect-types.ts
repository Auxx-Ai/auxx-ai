// packages/lib/src/postings/application-effect-types.ts

/**
 * The effect contract for `deposit_application` — the last of D19's seven
 * (plans/accounting/tasks/53-two-modes-one-ledger.md §7.3.3).
 *
 * ## 🔑 Why this is not a document family
 *
 * Every family in `document-effect-types.ts` is owned by an `EntityInstance`
 * that IS the event: an invoice is issued, a payout settles, a bill is
 * accrued. A deposit application is not like that. The event is a customer's
 * MONEY changing character — a prepayment we owed them becomes a receivable
 * they no longer owe us — and the invoice is the thing it was applied TO, not
 * the thing that happened.
 *
 * So the obligation is money-owned: `AccountingWork.moneyTransactionId` is set
 * and `entityInstanceId` is null, exactly as `customer_receipt` and
 * `customer_refund` are. The invoice rides in the calculation and in
 * `documentRefs`, where a reference belongs.
 *
 * ## 🔑 The identity is the APPLICATION, not the transaction
 *
 * One receipt can be applied to several invoices, and each application is its
 * own event on its own day. So `effectKey` is derived from the
 * `MoneyApplication` id (see `moneyApplicationAccountingEffectKey`), and
 * `AccountingWork_money_original_key` — the partial unique that says "one
 * original per money transaction per kind" — is narrowed to exclude this
 * family, because that sentence is false of an application.
 *
 * 🛑 A second application is NOT `operation: 'correction'`. The first one was
 * not a mistake; the customer simply had money left over.
 *
 * ## 🛑 What this contract is NOT
 *
 * It is not the dispatch-era `PaymentAllocation` path in
 * `money/payments/post-deposit-application.ts`. That lane has its own
 * `PaymentTransaction` ledger, which ~20 live modules still read and write, and
 * it is deliberately NOT an `AccountingWork` owner: giving the legacy payments
 * tables a third owner column on `AccountingWork` would make every future reader
 * handle a third owner kind forever. The two lanes claim disjoint `periodKey`s
 * and never post the same journal.
 *
 * @see plans/accounting/tasks/07-customer-deposits.md
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

/** The `AccountingWork.effectKind` this contract belongs to. */
export const MONEY_APPLICATION_EFFECT_KIND = 'deposit_application' as const

/** The `GlPostingType` an application journal claims. */
export const MONEY_APPLICATION_POSTING_TYPE = 'deposit_application' as const

/** The `documentRefs` kind the applied-to invoice is named under. */
export const MONEY_APPLICATION_RESOURCE_KIND = 'invoice' as const

/**
 * One line of the application's entry, BEFORE account resolution.
 *
 * Both legs are roles in practice (`customer_deposits`, `accounts_receivable`),
 * but the either/or is kept so a chart that pins one leg by id does not need a
 * second contract.
 */
const applicationLineSchema = z
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
    'An application line names either an account role or an account id, never both and never neither'
  )
  .refine(
    (line) => (line.counterpartyType === null) === (line.counterpartyId === null),
    'Counterparty type and ID must be supplied together'
  )

/** The exact application facts and entry lines frozen for one reclass journal. */
export const moneyApplicationBasisSchema = z
  .strictObject({
    version: z.literal(1),
    /** The `MoneyApplication` row. The obligation's identity, not merely evidence. */
    moneyApplicationId: id,
    /** The `MoneyTransaction` whose money is being reclassed — the work's owner. */
    moneyTransactionId: id,
    /** The `invoice` EntityInstance the money was applied to. */
    invoiceInstanceId: id,
    /** The invoice's own number, for the memo. `null` when it has none yet. */
    invoiceNumber: z.string().nullable(),
    /** The customer, for the counterparty on both balance-sheet legs. */
    contactInstanceId: id.nullable(),
    sourceHash: hash,
    /**
     * The APPLICATION's own day, never the day the money arrived. The
     * prepayment changed character when it was applied.
     */
    effectiveDate: date,
    currency: z.literal('USD'),
    currencyExponent: z.literal(2),
    /** Total debit. What leaves `customer_deposits`. */
    amountMinor: positiveMinor,
    lines: z.array(applicationLineSchema).min(2),
  })
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    const keys = value.lines.map((line) => line.lineKey)
    if (new Set(keys).size !== keys.length) issue('Duplicate application line key')
    let balance = 0n
    let debit = 0n
    for (const line of value.lines) {
      const amount = BigInt(line.amountMinor)
      balance += line.direction === 'debit' ? amount : -amount
      if (line.direction === 'debit') debit += amount
      if (amount > BigInt(Number.MAX_SAFE_INTEGER))
        issue('Amount exceeds the current ledger safe-number boundary')
    }
    if (balance !== 0n) issue('Application lines must balance independently')
    if (debit !== BigInt(value.amountMinor))
      issue('Application lines do not equal the applied amount')
  })

/** Durable incomplete evidence is allowed; only ready input can be accepted. */
export const moneyApplicationWorkBasisSchema = z
  .discriminatedUnion('status', [
    z.strictObject({
      version: z.literal(1),
      status: z.literal('incomplete'),
      moneyApplicationId: id,
      moneyTransactionId: id,
      sourceHash: hash,
      effectiveDate: date.nullable(),
      missingDependencies: z.array(id).min(1),
      observed: z.record(z.string(), z.json()),
    }),
    z.strictObject({
      version: z.literal(1),
      status: z.literal('ready'),
      moneyApplicationId: id,
      moneyTransactionId: id,
      sourceHash: hash,
      effectiveDate: date,
      calculation: moneyApplicationBasisSchema,
    }),
  ])
  .superRefine((value, ctx) => {
    if (value.status !== 'ready') return
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (value.moneyApplicationId !== value.calculation.moneyApplicationId)
      issue('Application work owner differs from its calculation')
    if (value.moneyTransactionId !== value.calculation.moneyTransactionId)
      issue('Application work movement differs from its calculation')
    if (value.sourceHash !== value.calculation.sourceHash)
      issue('Application work hash differs from its calculation')
    if (value.effectiveDate !== value.calculation.effectiveDate)
      issue('Application work date differs from its calculation')
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
  selectedBy: z.enum(['document', 'route', 'source_profile', 'org_role', 'original_effect']),
  configurationHash: hash,
})

/**
 * Immutable, independently balanced contribution pinned to one ready
 * application work version.
 *
 * 🔑 The load-bearing check is the last one, and it is the same one the document
 * contract makes: the accepted contribution must be the frozen application lines
 * with their accounts resolved — same keys, same directions, same amounts, same
 * counterparties. An accepted effect that drifts from the application it names
 * is the failure this contract exists to make impossible.
 */
export const acceptedMoneyApplicationEffectBasisSchema = z
  .strictObject({
    version: z.literal(1),
    sourceBasisVersion: z.number().int().positive(),
    sourceHash: hash,
    policyKey: z.literal('money_application_v1'),
    policyVersion: z.literal(1),
    /** Reserved (D13). Absent everywhere today; see `basis-dimension.ts`. */
    basis: reservedAccountingBasis,
    effectiveDate: date,
    bookTimeZone,
    currency: z.literal('USD'),
    currencyExponent: z.literal(2),
    documentRefs: z.array(z.strictObject({ resourceKind: id, entityInstanceId: id })).min(1),
    calculation: moneyApplicationBasisSchema,
    accountResolution: z.array(accountResolutionSchema).min(2),
    contribution: z.array(contributionSchema).min(2),
  })
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (value.sourceHash !== value.calculation.sourceHash) issue('Calculation source hash differs')
    if (value.effectiveDate !== value.calculation.effectiveDate)
      issue('Application effect date differs from its calculation date')
    if (
      !value.documentRefs.some(
        (ref) =>
          ref.resourceKind === MONEY_APPLICATION_RESOURCE_KIND &&
          ref.entityInstanceId === value.calculation.invoiceInstanceId
      )
    )
      issue('Missing invoice source reference')

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
    if (debit !== BigInt(value.calculation.amountMinor))
      issue('Effect debit total must equal the applied amount')

    const applicationLines = new Map(value.calculation.lines.map((line) => [line.lineKey, line]))
    if (applicationLines.size !== value.contribution.length)
      issue('Contribution must carry exactly one line per application line')
    for (const line of value.contribution) {
      const source = applicationLines.get(line.lineKey)
      if (!source) {
        issue(`Contribution line ${line.lineKey} is not a line of this application`)
        continue
      }
      if (
        source.direction !== line.direction ||
        source.amountMinor !== line.amountMinor ||
        source.counterpartyType !== line.counterpartyType ||
        source.counterpartyId !== line.counterpartyId
      )
        issue(`Contribution line ${line.lineKey} differs from the application line it names`)
      const resolution = resolutions.get(line.lineKey)
      if (source.glAccountId !== null && source.glAccountId !== line.glAccountId)
        issue(`Contribution line ${line.lineKey} left the account its application named`)
      if (source.accountRole !== null && resolution?.accountRole !== source.accountRole)
        issue(`Contribution line ${line.lineKey} left the account role its application named`)
    }
  })

export type MoneyApplicationBasisV1 = z.infer<typeof moneyApplicationBasisSchema>
export type MoneyApplicationWorkBasisInput = z.infer<typeof moneyApplicationWorkBasisSchema>
export type AcceptedMoneyApplicationEffectBasisV1 = z.infer<
  typeof acceptedMoneyApplicationEffectBasisSchema
>
