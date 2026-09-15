// packages/lib/src/postings/effect-types.ts
import { z } from 'zod'

const id = z.string().min(1)
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const minor = z.string().regex(/^(0|[1-9][0-9]*)$/, { abort: true })
const decimal = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/)
const positiveDecimal = decimal.refine((v) => /[1-9]/.test(v), 'Must be positive')
const date = z.iso.date()
const dimensions = z.record(z.string().min(1), z.string().min(1))

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
export const accountingWorkBasisSchema = z
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
    policyKey: z.literal('fulfillment_current_v1'),
    policyVersion: z.literal(1),
    effectiveDate: date,
    bookTimeZone: id.refine((v) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: v })
        return true
      } catch {
        return false
      }
    }, 'Unknown book time zone'),
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
export type AccountingWorkBasisInput = z.infer<typeof accountingWorkBasisSchema>
export type AcceptedFulfillmentEffectBasisV1 = z.infer<typeof acceptedFulfillmentEffectBasisSchema>
