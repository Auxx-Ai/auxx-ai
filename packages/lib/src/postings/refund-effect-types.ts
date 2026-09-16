// packages/lib/src/postings/refund-effect-types.ts

import { dayKeyInZone } from '@auxx/utils/calendar-day'
import { z } from 'zod'
import { reservedAccountingBasis } from './basis-dimension'

const id = z.string().min(1)
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const minor = z.string().regex(/^(0|[1-9][0-9]*)$/)
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

const settlementSchema = z.strictObject({
  settlementId: id,
  creditMemoInstanceId: id,
  amountMinor: minor.refine((value) => BigInt(value) > 0n, 'Settlement must be positive'),
  creditControlAccountId: id,
})

const routeSchema = z.strictObject({
  paymentRouteId: id,
  kind: z.enum(['processor', 'manual']),
  method: id,
  settlementCurrency: z.string().regex(/^[A-Z]{3}$/),
  endpointGlAccountId: id,
  processorAccountId: id.nullable(),
  gatewayInstanceId: id.nullable(),
})

/** Exact facts needed to account for a confirmed customer refund. */
export const customerRefundAccountingBasisSchema = z
  .strictObject({
    version: z.literal(1),
    moneyTransactionId: id,
    currency: z.literal('USD'),
    currencyExponent: z.literal(2),
    amountMinor: minor.refine((value) => BigInt(value) > 0n, 'Refund must be positive'),
    datePrecision: z.enum(['instant', 'date']),
    occurredAt: z.iso.datetime().nullable(),
    occurredOn: date.nullable(),
    effectiveDate: date,
    creditMemoInstanceIds: z.array(id).min(1),
    settlements: z.array(settlementSchema).min(1),
    route: routeSchema,
    sourceHash: hash,
  })
  .superRefine((value, ctx) => {
    if (
      (value.datePrecision === 'date' &&
        (value.occurredOn === null || value.occurredAt !== null)) ||
      (value.datePrecision === 'instant' &&
        (value.occurredAt === null || value.occurredOn !== null))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Refund occurrence precision does not match its date fields',
      })
    if (value.datePrecision === 'date' && value.effectiveDate !== value.occurredOn)
      ctx.addIssue({
        code: 'custom',
        message: 'Date-only refund effect must use its occurrence date',
      })
    const total = value.settlements.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n)
    if (total !== BigInt(value.amountMinor))
      ctx.addIssue({ code: 'custom', message: 'Refund settlements must equal the refund amount' })
    if (
      total > BigInt(Number.MAX_SAFE_INTEGER) ||
      BigInt(value.amountMinor) > BigInt(Number.MAX_SAFE_INTEGER) ||
      value.settlements.some((item) => BigInt(item.amountMinor) > BigInt(Number.MAX_SAFE_INTEGER))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Refund exceeds the current ledger safe-number boundary',
      })
    if (
      value.creditMemoInstanceIds.length !== new Set(value.creditMemoInstanceIds).size ||
      value.settlements.length !==
        new Set(value.settlements.map((item) => item.settlementId)).size ||
      new Set(value.settlements.map((item) => item.creditMemoInstanceId)).size !==
        value.creditMemoInstanceIds.length ||
      value.settlements.some(
        (settlement) => !value.creditMemoInstanceIds.includes(settlement.creditMemoInstanceId)
      )
    )
      ctx.addIssue({ code: 'custom', message: 'Refund credit memo partition is inconsistent' })
    if (value.route.settlementCurrency !== value.currency)
      ctx.addIssue({ code: 'custom', message: 'Refund route currency differs from the movement' })
    if (value.route.kind === 'processor') {
      if (!value.route.processorAccountId || !value.route.gatewayInstanceId)
        ctx.addIssue({ code: 'custom', message: 'Processor refund route identity is incomplete' })
    } else if (value.route.processorAccountId || value.route.gatewayInstanceId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Manual refund route cannot carry processor identity',
      })
    }
  })

/** Durable incomplete or ready input for one customer-refund accounting work item. */
export const customerRefundWorkBasisSchema = z.discriminatedUnion('status', [
  z.strictObject({
    version: z.literal(1),
    status: z.literal('incomplete'),
    moneyTransactionId: id,
    sourceHash: hash,
    effectiveDate: date.nullable(),
    missingDependencies: z.array(id).min(1),
    observed: z.record(z.string(), z.json()),
  }),
  z
    .strictObject({
      version: z.literal(1),
      status: z.literal('ready'),
      moneyTransactionId: id,
      sourceHash: hash,
      effectiveDate: date,
      calculation: customerRefundAccountingBasisSchema,
    })
    .superRefine((value, ctx) => {
      if (value.moneyTransactionId !== value.calculation.moneyTransactionId)
        ctx.addIssue({ code: 'custom', message: 'Refund work owner differs from its calculation' })
      if (value.sourceHash !== value.calculation.sourceHash)
        ctx.addIssue({ code: 'custom', message: 'Refund work hash differs from its calculation' })
      if (value.effectiveDate !== value.calculation.effectiveDate)
        ctx.addIssue({ code: 'custom', message: 'Refund work date differs from its calculation' })
    }),
])

const contributionSchema = z
  .strictObject({
    lineKey: id,
    glAccountId: id,
    direction: z.enum(['debit', 'credit']),
    amountMinor: minor.refine((value) => BigInt(value) > 0n, 'Contribution must be positive'),
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

/** Immutable accepted basis for provider-neutral customer-refund accounting. */
export const acceptedCustomerRefundEffectBasisSchema = z
  .strictObject({
    version: z.literal(1),
    sourceBasisVersion: z.number().int().positive(),
    sourceHash: hash,
    policyKey: z.literal('customer_refund_v1'),
    policyVersion: z.literal(1),
    /** Reserved (D13). Absent everywhere today; see `basis-dimension.ts`. */
    basis: reservedAccountingBasis,
    effectiveDate: date,
    bookTimeZone,
    currency: z.literal('USD'),
    currencyExponent: z.literal(2),
    documentRefs: z.array(z.strictObject({ resourceKind: id, entityInstanceId: id })).min(2),
    calculation: customerRefundAccountingBasisSchema,
    accountResolution: z.array(accountResolutionSchema).min(2),
    contribution: z.array(contributionSchema).min(2),
  })
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (value.sourceHash !== value.calculation.sourceHash) issue('Refund source hash differs')
    if (value.effectiveDate !== value.calculation.effectiveDate)
      issue('Refund effect date differs from its calculation date')
    if (
      value.calculation.datePrecision === 'instant' &&
      dayKeyInZone(new Date(value.calculation.occurredAt!), value.bookTimeZone) !==
        value.effectiveDate
    )
      issue('Refund effect date differs from the occurrence date in the book time zone')
    if (
      !value.documentRefs.some(
        (ref) =>
          ref.resourceKind === 'money_transaction' &&
          ref.entityInstanceId === value.calculation.moneyTransactionId
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
      balance += line.direction === 'debit' ? amount : -amount
      if (line.direction === 'debit') debit += amount
      if (resolutions.get(line.lineKey)?.glAccountId !== line.glAccountId)
        issue('Resolved account differs from contribution')
      if (amount > BigInt(Number.MAX_SAFE_INTEGER))
        issue('Amount exceeds ledger safe-number boundary')
    }
    if (balance !== 0n) issue('Effect contribution must balance independently')
    if (debit !== BigInt(value.calculation.amountMinor))
      issue('Refund debit total must equal the refund amount')
    if (debit > BigInt(Number.MAX_SAFE_INTEGER))
      issue('Refund total exceeds the current ledger safe-number boundary')
    const routeCredits = value.contribution
      .filter(
        (line) =>
          line.direction === 'credit' &&
          line.glAccountId === value.calculation.route.endpointGlAccountId
      )
      .reduce((sum, line) => sum + BigInt(line.amountMinor), 0n)
    if (routeCredits !== BigInt(value.calculation.amountMinor))
      issue('Refund route credit must equal the refund amount')
    for (const [index, settlement] of value.calculation.settlements.entries()) {
      const line = value.contribution.find((candidate) => candidate.lineKey === `line:${index}`)
      if (
        !line ||
        line.direction !== 'debit' ||
        line.glAccountId !== settlement.creditControlAccountId ||
        line.amountMinor !== settlement.amountMinor ||
        line.dimensions.creditMemoInstanceId !== settlement.creditMemoInstanceId ||
        line.dimensions.settlementId !== settlement.settlementId
      )
        issue('Each refund settlement must match its frozen credit-control debit')
    }
  })

export type CustomerRefundAccountingBasisV1 = z.infer<typeof customerRefundAccountingBasisSchema>
export type CustomerRefundWorkBasisInput = z.infer<typeof customerRefundWorkBasisSchema>
export type AcceptedCustomerRefundEffectBasisV1 = z.infer<
  typeof acceptedCustomerRefundEffectBasisSchema
>
