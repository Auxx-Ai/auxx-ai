// packages/lib/src/postings/credit-effect-types.ts

import { z } from 'zod'

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

/** The source label is a domain fact, not a payment-provider identity. */
const source = z.enum(['native', 'channel'])
const componentAccountRole = z.enum([
  'revenue_returns_allowances',
  'customer_deposits',
  'sales_tax_payable',
])
const componentKey = z.enum(['earned_revenue', 'customer_deposit', 'sales_tax'])

const creditComponentSchema = z.strictObject({
  componentKey,
  accountRole: componentAccountRole,
  direction: z.literal('debit'),
  amountMinor: minor.refine((value) => BigInt(value) > 0n, 'Component must be positive'),
})
const sourceAllocationSchema = z.strictObject({
  effectId: id,
  lineKey: id,
  amountMinor: minor.refine((value) => BigInt(value) > 0n, 'Allocation must be positive'),
  componentKey,
})

/** Exact facts needed to account for a credit entitlement. */
export const customerCreditAccountingBasisSchema = z
  .strictObject({
    version: z.literal(1),
    creditMemoInstanceId: id,
    sourceHash: hash,
    source,
    number: id,
    contactInstanceId: id.nullable(),
    invoiceInstanceId: id.nullable(),
    orderInstanceId: id.nullable(),
    sourceStoreId: id.nullable(),
    creditControlGlAccountId: id,
    issuedAt: date,
    effectiveDate: date,
    currency: z.literal('USD'),
    currencyExponent: z.literal(2),
    subtotalMinor: minor,
    taxTotalMinor: minor,
    totalMinor: minor.refine((value) => BigInt(value) > 0n, 'Credit must be positive'),
    reverseRevenue: z.boolean(),
    components: z.array(creditComponentSchema).min(1),
    sourceAllocations: z.array(sourceAllocationSchema),
  })
  .superRefine((value, ctx) => {
    if (value.issuedAt !== value.effectiveDate)
      ctx.addIssue({ code: 'custom', message: 'Credit issue and effect dates must agree' })
    if (BigInt(value.totalMinor) !== BigInt(value.subtotalMinor) + BigInt(value.taxTotalMinor))
      ctx.addIssue({ code: 'custom', message: 'Credit totals do not add to the total' })
    if (
      new Set(value.components.map((component) => component.componentKey)).size !==
      value.components.length
    )
      ctx.addIssue({ code: 'custom', message: 'Credit components must have unique keys' })
    const componentTotal = value.components.reduce(
      (sum, component) => sum + BigInt(component.amountMinor),
      0n
    )
    if (componentTotal !== BigInt(value.totalMinor))
      ctx.addIssue({ code: 'custom', message: 'Credit components must equal the memo total' })
    const allocationTotal = value.sourceAllocations.reduce(
      (sum, allocation) => sum + BigInt(allocation.amountMinor),
      0n
    )
    if (value.source === 'native' && value.sourceAllocations.length > 0)
      ctx.addIssue({
        code: 'custom',
        message: 'Native credit memos cannot claim source allocations',
      })
    if (value.source === 'channel' && value.sourceAllocations.length === 0)
      ctx.addIssue({ code: 'custom', message: 'Channel credits require source allocations' })
    if (value.source === 'channel' && allocationTotal !== BigInt(value.totalMinor))
      ctx.addIssue({
        code: 'custom',
        message: 'Channel source allocations must equal the memo total',
      })
    const componentAmounts = new Map<string, bigint>(
      value.components.map((component) => [component.componentKey, BigInt(component.amountMinor)])
    )
    const allocatedByComponent = new Map<string, bigint>()
    for (const allocation of value.sourceAllocations)
      allocatedByComponent.set(
        allocation.componentKey,
        (allocatedByComponent.get(allocation.componentKey) ?? 0n) + BigInt(allocation.amountMinor)
      )
    for (const [key, amount] of componentAmounts) {
      if ((allocatedByComponent.get(key) ?? 0n) !== (value.source === 'native' ? 0n : amount))
        ctx.addIssue({ code: 'custom', message: `Source allocations do not equal ${key}` })
    }
    for (const key of allocatedByComponent.keys())
      if (!componentAmounts.has(key))
        ctx.addIssue({
          code: 'custom',
          message: `Source allocation names unknown component ${key}`,
        })
    const expectedRole: Record<
      z.infer<typeof componentKey>,
      z.infer<typeof componentAccountRole>
    > = {
      earned_revenue: 'revenue_returns_allowances',
      customer_deposit: 'customer_deposits',
      sales_tax: 'sales_tax_payable',
    }
    for (const component of value.components) {
      if (component.accountRole !== expectedRole[component.componentKey])
        ctx.addIssue({ code: 'custom', message: 'Credit component account role is incompatible' })
    }
  })

/** Durable incomplete or ready input for a customer-credit accounting work item. */
export const customerCreditWorkBasisSchema = z.discriminatedUnion('status', [
  z.strictObject({
    version: z.literal(1),
    status: z.literal('incomplete'),
    creditMemoInstanceId: id,
    sourceHash: hash,
    effectiveDate: date.nullable(),
    missingDependencies: z.array(id).min(1),
    observed: z.record(z.string(), z.json()),
  }),
  z.strictObject({
    version: z.literal(1),
    status: z.literal('ready'),
    creditMemoInstanceId: id,
    sourceHash: hash,
    effectiveDate: date,
    calculation: customerCreditAccountingBasisSchema,
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

/** Immutable accepted basis for the provider-neutral credit entitlement journal. */
export const acceptedCustomerCreditEffectBasisSchema = z
  .strictObject({
    version: z.literal(1),
    sourceBasisVersion: z.number().int().positive(),
    sourceHash: hash,
    policyKey: z.literal('customer_credit_issued_v1'),
    policyVersion: z.literal(1),
    effectiveDate: date,
    bookTimeZone,
    currency: z.literal('USD'),
    currencyExponent: z.literal(2),
    documentRefs: z.array(z.strictObject({ resourceKind: id, entityInstanceId: id })).min(1),
    calculation: customerCreditAccountingBasisSchema,
    accountResolution: z.array(accountResolutionSchema).min(2),
    contribution: z.array(contributionSchema).min(2),
  })
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (value.sourceHash !== value.calculation.sourceHash) issue('Credit source hash differs')
    if (value.effectiveDate !== value.calculation.effectiveDate)
      issue('Credit effect date differs from its calculation date')
    if (
      !value.documentRefs.some(
        (ref) =>
          ref.resourceKind === 'credit_memo' &&
          ref.entityInstanceId === value.calculation.creditMemoInstanceId
      )
    )
      issue('Missing credit memo source reference')
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
    if (debit !== BigInt(value.calculation.totalMinor))
      issue('Credit debit total must equal the memo total')
    const controlLines = value.contribution.filter(
      (line) =>
        line.direction === 'credit' &&
        line.glAccountId === value.calculation.creditControlGlAccountId
    )
    if (
      controlLines.length !== 1 ||
      BigInt(controlLines[0]?.amountMinor ?? '0') !== BigInt(value.calculation.totalMinor)
    )
      issue('Credit control account must be the credited entitlement account')
  })

export type CustomerCreditAccountingBasisV1 = z.infer<typeof customerCreditAccountingBasisSchema>
export type CustomerCreditWorkBasisInput = z.infer<typeof customerCreditWorkBasisSchema>
export type AcceptedCustomerCreditEffectBasisV1 = z.infer<
  typeof acceptedCustomerCreditEffectBasisSchema
>
