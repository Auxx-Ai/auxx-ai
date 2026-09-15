// packages/lib/src/money/fulfillment-posting/work.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ConflictError, UnprocessableEntityError } from '../../errors'
import type { PreparedEffectMember } from '../../postings/accept-entry'
import { withAccountingCommitLock } from '../../postings/accounting-commit-lock'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import {
  buildFulfillmentBatchEntry,
  computeShipmentAmounts,
  resolveFulfillmentDebit,
} from '../../postings/build-fulfillment-batch-entry'
import { buildFulfillmentEntry } from '../../postings/build-fulfillment-entry'
import {
  accountingBasisHash,
  correctionAccountingEffectKey,
  fromLedgerMinor,
} from '../../postings/effect-basis'
import {
  type AcceptedFulfillmentEffectBasisV1,
  type AccountingWorkBasisInput,
  acceptedFulfillmentEffectBasisSchema,
  accountingWorkBasisSchema,
} from '../../postings/effect-types'
import {
  appendFulfillmentWorkBasisInTx,
  captureFulfillmentWorkInTx,
} from '../../postings/effect-work'
import { resolveAccountLines } from '../../postings/resolve-roles'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import type { BuiltEntry } from '../../postings/types'
import { getOrganizationSetting } from '../../settings/settings-service'
import { readOrderRecognitionFactsInTx } from '../customer-money/recognition-facts'
import { financialFields } from '../fulfillments/field-context'
import { loadFulfillmentFieldContext } from '../fulfillments/reads'
import { loadGatewayRoutesForPlan } from './plan'
import { readFulfillmentPostingSettings, readUnpostedShipments, toCalendarDay } from './reads'
import {
  FULFILLMENT_POSTING_SETTING_KEY,
  type FulfillmentPostingGroup,
  type PlannedShipment,
} from './types'

type Eligibility = 'automatic' | 'manual' | 'excluded'
type ReadyBasis = Extract<AccountingWorkBasisInput, { status: 'ready' }>

/** Source identity and calculation output read while holding the accounting lock. */
export interface FulfillmentAccountingSource {
  shipment: PlannedShipment
  basis: ReadyBasis
  entry: BuiltEntry
}

/** Preserve the source number's decimal digits without exponent notation in durable contracts. */
export function fulfillmentDecimal(value: number): string {
  if (!Number.isFinite(value) || value < 0)
    throw new UnprocessableEntityError(
      'Financial quantities and rates must be finite and nonnegative'
    )
  const text = String(value)
  if (!text.includes('e')) return text
  const [coefficient, exponent] = text.split('e')
  const [whole, fractional = ''] = coefficient!.split('.')
  const digits = whole! + fractional
  const point = whole!.length + Number(exponent)
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length)
  return `${digits.slice(0, point)}.${digits.slice(point)}`
}

/** One shipment as an independently balanced group, preserving existing arithmetic. */
export function singleShipmentGroup(shipment: PlannedShipment): FulfillmentPostingGroup {
  const amounts = shipment.amounts
  return {
    groupKey: shipment.shippedAt,
    txnDate: shipment.shippedAt,
    shipments: [shipment],
    orderCount: 1,
    totals: {
      ...amounts,
      byDebitRole: {
        clearing_card: amounts.debitRole === 'clearing_card' ? amounts.totalMinor : 0,
        accounts_receivable:
          amounts.debitRole === 'accounts_receivable'
            ? (amounts.receivableDebitMinor ?? amounts.totalMinor)
            : 0,
        gateway: amounts.debitRole === 'gateway' ? amounts.totalMinor : 0,
      },
    },
  }
}

/** Read complete live financial dependencies; missing/legacy evidence refuses sealing. */
export async function readFulfillmentAccountingSourceInTx(
  tx: Transaction,
  organizationId: string,
  fulfillmentInstanceId: string
): Promise<FulfillmentAccountingSource> {
  await withAccountingCommitLock(tx, organizationId)
  const instance = await tx.query.EntityInstance.findFirst({
    where: and(
      eq(schema.EntityInstance.organizationId, organizationId),
      eq(schema.EntityInstance.id, fulfillmentInstanceId),
      isNull(schema.EntityInstance.archivedAt)
    ),
  })
  if (!instance) throw new UnprocessableEntityError('Fulfillment is missing or archived')
  const ctx = await loadFulfillmentFieldContext(organizationId, tx)
  if (!ctx || instance.entityDefinitionId !== ctx.fulfillmentDefId)
    throw new UnprocessableEntityError('Fulfillment identity is unresolved')
  const date = await tx.query.FieldValue.findFirst({
    where: and(
      eq(schema.FieldValue.organizationId, organizationId),
      eq(schema.FieldValue.entityId, fulfillmentInstanceId),
      eq(schema.FieldValue.fieldId, ctx.fulfillment.fulfillment_shipped_at?.id ?? '')
    ),
  })
  const configuredTimeZone = await getOrganizationSetting({
    organizationId,
    key: OPENING_BASELINE_SETTING_KEYS.bookTimeZone,
    db: tx,
  })
  const bookTimeZone =
    typeof configuredTimeZone === 'string' && configuredTimeZone.trim()
      ? configuredTimeZone.trim()
      : null
  const shippedOn = toCalendarDay(date?.valueDate, bookTimeZone ?? 'UTC')
  if (!shippedOn || !z.iso.date().safeParse(shippedOn).success)
    throw new UnprocessableEntityError('Fulfillment ship date is unresolved')
  const tomorrow = new Date(`${shippedOn}T00:00:00.000Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const read = await readUnpostedShipments(tx, {
    organizationId,
    range: { from: shippedOn, to: tomorrow.toISOString().slice(0, 10) },
    fulfillmentIds: [fulfillmentInstanceId],
  })
  if (read.isErr()) throw read.error
  const shipment = read.value.find((row) => row.fulfillmentInstanceId === fulfillmentInstanceId)
  if (!shipment)
    throw new UnprocessableEntityError('Fulfillment is incomplete, canceled, or already accepted')
  if (shipment.legacyPostingId)
    throw new UnprocessableEntityError(
      'Historical fulfillment journal requires explicit membership repair'
    )
  const legacy = await tx.query.GlPosting.findFirst({
    where: and(
      eq(schema.GlPosting.organizationId, organizationId),
      eq(schema.GlPosting.postingType, 'fulfillment'),
      isNull(schema.GlPosting.deliveryIntent),
      sql`(${schema.GlPosting.draft}->'entry'->'sources' @> ${JSON.stringify([{ orderId: shipment.orderId, sequence: shipment.sequence }])}::jsonb
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(${schema.GlPosting.draft}->'entry'->'lines', '[]'::jsonb)) AS line
        WHERE line->>'sourceType' = 'order' AND line->>'sourceId' = ${shipment.orderId}))`
    ),
    columns: { id: true },
  })
  if (legacy)
    throw new UnprocessableEntityError(
      'Historical order journal requires explicit membership repair'
    )
  const edges = await tx
    .select({ id: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, ctx.line.fulfillment_line_fulfillment!.id),
        eq(schema.FieldValue.relatedEntityId, fulfillmentInstanceId)
      )
    )
  if (!shipment.lines.length || edges.length !== shipment.lines.length)
    throw new UnprocessableEntityError('Every fulfillment line must have a resolved order line')
  const dependencies = [
    shipment.orderId,
    ...shipment.lines.map((line) => line.lineId),
    ...(shipment.contactId ? [shipment.contactId] : []),
  ]
  const live = await tx
    .select({ id: schema.EntityInstance.id, kind: schema.EntityDefinition.entityType })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      and(
        eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId),
        eq(schema.EntityDefinition.organizationId, organizationId),
        isNull(schema.EntityDefinition.archivedAt)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, dependencies),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  const kindById = new Map(live.map((row) => [row.id, row.kind]))
  if (
    kindById.size !== new Set(dependencies).size ||
    kindById.get(shipment.orderId) !== 'order' ||
    shipment.lines.some((line) => kindById.get(line.lineId) !== 'line_item')
  )
    throw new UnprocessableEntityError('An order, order line, or customer dependency is missing')
  const ownership = await financialFields(organizationId, ['line_item_order'] as const, tx)
  if (!ownership.line_item_order)
    throw new UnprocessableEntityError('Order line ownership field is missing')
  const ownedLines = await tx
    .select({ id: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, ownership.line_item_order.id),
        eq(schema.FieldValue.relatedEntityId, shipment.orderId),
        inArray(
          schema.FieldValue.entityId,
          shipment.lines.map((line) => line.lineId)
        )
      )
    )
  if (new Set(ownedLines.map((row) => row.id)).size !== shipment.lines.length)
    throw new UnprocessableEntityError(
      'A fulfillment line belongs to another order or has unresolved ownership'
    )
  const routes = await loadGatewayRoutesForPlan(tx, organizationId)
  const metadata = z.record(z.string(), z.unknown()).safeParse(instance.metadata)
  const native = metadata.success && metadata.data.accountingFulfillmentLane === 'native'
  const route = shipment.recognitionAllocation
    ? {
        kind: 'debit' as const,
        role: 'accounts_receivable' as const,
        reason: 'Canonical Shopify receipt timeline owns deposit and receivable allocation',
      }
    : native
      ? {
          kind: 'debit' as const,
          role: 'accounts_receivable' as const,
          reason: 'Native fulfillment current policy recognizes an order receivable',
        }
      : resolveFulfillmentDebit({
          financialStatus: shipment.financialStatus,
          gateways: shipment.gateways,
          gatewayRoutes: routes,
        })
  if (route.kind === 'exclude')
    throw new UnprocessableEntityError(`Unresolved debit route: ${route.reason}`)
  if (shipment.currency && shipment.currency.toUpperCase() !== 'USD')
    throw new UnprocessableEntityError('Foreign currency requires accounting review')
  const recognitionFacts = shipment.recognitionAllocation
    ? await readOrderRecognitionFactsInTx(tx, organizationId, shipment.orderId)
    : null
  if (
    recognitionFacts &&
    (recognitionFacts.subtotal !== BigInt(shipment.orderSubtotalMinor) ||
      recognitionFacts.tax !== BigInt(shipment.orderTaxTotalMinor) ||
      recognitionFacts.shipping !== BigInt(shipment.orderShippingTotalMinor))
  ) {
    throw new UnprocessableEntityError(
      'Canonical recognition facts changed after the fulfillment source was read'
    )
  }
  const amounts = computeShipmentAmounts(shipment, route)
  if (amounts.totalMinor <= 0)
    throw new UnprocessableEntityError('Fulfillment has no positive accounting contribution')
  const planned = { ...shipment, amounts }
  const sourceHash = accountingBasisHash({
    shipment: JSON.parse(JSON.stringify(shipment)),
    native,
    routes,
  })
  const calculation = {
    version: 1 as const,
    fulfillmentInstanceId,
    orderInstanceId: shipment.orderId,
    customerInstanceId: shipment.contactId,
    sequence: shipment.sequence,
    sourceRevision: sourceHash,
    sourceHash,
    shippedOn,
    channel: shipment.channel,
    sourceStoreId: shipment.sourceStoreId ?? null,
    processorRouteId: shipment.processorRouteId ?? null,
    shippingRegion: null,
    dimensions: {},
    lines: shipment.lines.map((line) => ({
      fulfillmentLineId: line.fulfillmentLineId!,
      orderLineId: line.lineId,
      productInstanceId: null,
      sku: null,
      quantity: fulfillmentDecimal(line.quantity),
      orderedQuantity: fulfillmentDecimal(line.orderedQuantity),
      priorShippedQuantity: fulfillmentDecimal(line.priorShippedQuantity ?? 0),
      netUnitMinor: fulfillmentDecimal(line.unitPriceMinor),
      netLineMinor: line.lineTotalMinor == null ? null : fromLedgerMinor(line.lineTotalMinor),
      lineTaxMinor: line.lineTaxMinor == null ? null : fromLedgerMinor(line.lineTaxMinor),
    })),
    orderSubtotalMinor: fromLedgerMinor(shipment.orderSubtotalMinor),
    orderTaxMinor: fromLedgerMinor(shipment.orderTaxTotalMinor),
    orderShippingMinor: fromLedgerMinor(shipment.orderShippingTotalMinor),
    priorShipmentSubtotalMinor: fromLedgerMinor(shipment.priorShipmentsSubtotalMinor),
    shippingAllocationMinor: fromLedgerMinor(amounts.shippingMinor),
    includeShipping: shipment.includeShipping,
    ...(shipment.recognitionAllocation
      ? {
          recognitionAllocation: {
            amountMinor: fromLedgerMinor(shipment.recognitionAllocation.amountMinor),
            depositDebitMinor: fromLedgerMinor(shipment.recognitionAllocation.depositMinor),
            receivableDebitMinor: fromLedgerMinor(shipment.recognitionAllocation.receivableMinor),
            newlyRecognizedTaxMinor: fromLedgerMinor(shipment.recognitionAllocation.taxMinor),
            historyHash: shipment.recognitionAllocation.historyHash,
          },
          recognitionHistoryHash: shipment.recognitionAllocation.historyHash,
        }
      : {}),
    taxComponents:
      recognitionFacts && shipment.recognitionTaxComponents
        ? shipment.recognitionTaxComponents.map((share) => {
            const tax = recognitionFacts.taxComponents.find(
              (component) => component.componentKey === share.componentKey
            )
            if (!tax)
              throw new UnprocessableEntityError('Recognition tax component evidence changed')
            return {
              componentKey: share.componentKey,
              title: tax.jurisdiction ?? share.componentKey,
              amountMinor: fromLedgerMinor(share.amountMinor),
              jurisdiction: tax.jurisdiction,
              collector: tax.collector,
              remitter: tax.remitter,
              withholdingEvidenceId: tax.withholdingEvidenceId,
            }
          })
        : recognitionFacts
          ? recognitionFacts.taxComponents.map((tax) => ({
              componentKey: tax.componentKey,
              title: tax.jurisdiction ?? tax.componentKey,
              amountMinor: fromLedgerMinor(Number(tax.amountMinor)),
              jurisdiction: tax.jurisdiction,
              collector: tax.collector,
              remitter: tax.remitter,
              withholdingEvidenceId: tax.withholdingEvidenceId,
            }))
          : shipment.taxLines.map((tax, index) => ({
              componentKey: `tax:${index}`,
              title: tax.title,
              amountMinor: fromLedgerMinor(tax.priceMinor),
              jurisdiction: tax.title || null,
              collector: 'unknown' as const,
              remitter: 'unknown' as const,
              withholdingEvidenceId: null,
            })),
    debitRoute:
      'glAccountId' in route
        ? {
            kind: 'account' as const,
            glAccountId: route.glAccountId,
            reason: route.reason ?? 'Gateway clearing route',
          }
        : {
            kind: 'role' as const,
            role: route.role,
            reason: route.reason ?? 'Order payment state',
          },
  }
  const basis = accountingWorkBasisSchema.parse({
    version: 1,
    status: 'ready',
    fulfillmentInstanceId,
    sourceHash,
    effectiveDate: shippedOn,
    calculation,
  }) as ReadyBasis
  const entry = native
    ? buildFulfillmentEntry({
        orderId: shipment.orderId,
        orderNumber: shipment.orderNumber,
        sequence: shipment.sequence,
        channel: shipment.channel,
        currency: shipment.currency,
        ledgerCurrency: 'USD',
        txnDate: shippedOn,
        shippedLines: shipment.lines.map((line) => ({
          ...line,
          ...(line.lineTaxMinor == null
            ? {}
            : {
                taxMinor:
                  line.quantity >= line.orderedQuantity
                    ? line.lineTaxMinor
                    : Math.round((line.lineTaxMinor * line.quantity) / line.orderedQuantity),
              }),
        })),
        orderSubtotalMinor: shipment.orderSubtotalMinor,
        orderTaxTotalMinor: shipment.orderTaxTotalMinor,
        orderShippingTotalMinor: shipment.orderShippingTotalMinor,
        priorShipmentsSubtotalMinor: shipment.priorShipmentsSubtotalMinor,
        includeShipping: shipment.includeShipping,
        contactInstanceId: shipment.contactId,
        taxLines: shipment.taxLines,
        recognitionAllocation: shipment.recognitionAllocation,
        recognitionTaxComponents: shipment.recognitionTaxComponents,
        includeCogs: false,
      }).entry
    : buildFulfillmentBatchEntry({
        group: singleShipmentGroup(planned),
        ledgerCurrency: 'USD',
        attempt: 0,
      }).entry
  return { shipment: planned, basis, entry }
}

/** Capture complete or blocked source evidence in the source writer's transaction. */
export async function captureFulfillmentAccountingWorkInTx(
  tx: Transaction,
  input: {
    organizationId: string
    fulfillmentInstanceId: string
    eligibility?: Eligibility
  }
) {
  await withAccountingCommitLock(tx, input.organizationId)
  const existing = await tx.query.AccountingWork.findFirst({
    where: and(
      eq(schema.AccountingWork.organizationId, input.organizationId),
      eq(schema.AccountingWork.entityInstanceId, input.fulfillmentInstanceId),
      eq(schema.AccountingWork.operation, 'original')
    ),
  })
  if (existing?.state === 'accepted') return existing
  const mode = await getOrganizationSetting({
    organizationId: input.organizationId,
    key: FULFILLMENT_POSTING_SETTING_KEY,
    db: tx,
  })
  const enabled = await isAccountingEnabled(tx, input.organizationId)
  const eligibility = !enabled
    ? 'excluded'
    : (input.eligibility ??
      (existing?.eligibility === 'excluded'
        ? 'excluded'
        : mode === 'auto'
          ? 'automatic'
          : 'manual'))
  let basis: AccountingWorkBasisInput
  try {
    basis = (
      await readFulfillmentAccountingSourceInTx(
        tx,
        input.organizationId,
        input.fulfillmentInstanceId
      )
    ).basis
  } catch (error) {
    // SQL errors must escape so an aborted transaction cannot masquerade as captured work.
    if (
      !(
        error instanceof UnprocessableEntityError ||
        error instanceof ConflictError ||
        error instanceof z.ZodError
      )
    )
      throw error
    const observed = { fulfillmentInstanceId: input.fulfillmentInstanceId, reason: error.message }
    basis = {
      version: 1,
      status: 'incomplete',
      fulfillmentInstanceId: input.fulfillmentInstanceId,
      sourceHash: accountingBasisHash(observed),
      effectiveDate: null,
      missingDependencies: [error.message],
      observed,
    }
  }
  if (!existing)
    return (await captureFulfillmentWorkInTx(tx, { ...input, eligibility, basis })).work
  if (!['pending', 'blocked'].includes(existing.state)) return existing
  const saved = await appendFulfillmentWorkBasisInTx(tx, {
    organizationId: input.organizationId,
    workId: existing.id,
    expectedBasisVersion: existing.basisVersion,
    basis,
  })
  const [work] = await tx
    .update(schema.AccountingWork)
    .set({ eligibility, updatedAt: new Date() })
    .where(
      and(
        eq(schema.AccountingWork.organizationId, input.organizationId),
        eq(schema.AccountingWork.id, existing.id)
      )
    )
    .returning()
  if (!work) throw new Error('Accounting work vanished while locked')
  return { ...work, basisVersion: saved.version }
}

/** Build immutable per-source account decisions from live transaction state. */
export async function prepareFulfillmentEffectMemberInTx(
  tx: Transaction,
  organizationId: string,
  workId: string
): Promise<{ member: PreparedEffectMember; entry: BuiltEntry; shipment: PlannedShipment }> {
  const work = await tx.query.AccountingWork.findFirst({
    where: and(
      eq(schema.AccountingWork.organizationId, organizationId),
      eq(schema.AccountingWork.id, workId)
    ),
  })
  if (!work) throw new ConflictError('Accounting work is missing')
  if (!work.entityInstanceId)
    throw new ConflictError('Fulfillment accounting work has no source entity')
  const source = await readFulfillmentAccountingSourceInTx(
    tx,
    organizationId,
    work.entityInstanceId
  )
  const settings = await readFulfillmentPostingSettings(tx, organizationId)
  if (settings.isErr()) throw settings.error
  if (!settings.value.timeZone)
    throw new UnprocessableEntityError('Book time zone is not configured')
  const resolved = await resolveAccountLines(tx, organizationId, source.entry.lines)
  if (resolved.isErr()) throw resolved.error
  const accountResolution: AcceptedFulfillmentEffectBasisV1['accountResolution'] = []
  const contribution: AcceptedFulfillmentEffectBasisV1['contribution'] = []
  source.entry.lines.forEach((line, index) => {
    const account = resolved.value[index]!
    const lineKey = `line:${index}`
    accountResolution.push({
      lineKey,
      glAccountId: account.glAccountId,
      accountRole: line.accountRole ?? null,
      selectedBy: line.glAccountId ? 'route' : 'org_role',
      configurationHash: accountingBasisHash(account),
    })
    contribution.push({
      lineKey,
      glAccountId: account.glAccountId,
      direction: line.direction,
      amountMinor: fromLedgerMinor(line.amount),
      counterpartyType: line.counterpartyType ?? null,
      counterpartyId: line.counterpartyId ?? null,
      dimensions: line.dimensions ?? {},
    })
  })
  const acceptedBasis = acceptedFulfillmentEffectBasisSchema.parse({
    version: 1,
    sourceBasisVersion: work.basisVersion,
    sourceHash: source.basis.sourceHash,
    policyKey: source.shipment.recognitionAllocation
      ? 'shopify_payment_date_v1'
      : 'fulfillment_current_v1',
    policyVersion: 1,
    effectiveDate: source.basis.effectiveDate,
    bookTimeZone: settings.value.timeZone,
    currency: 'USD',
    currencyExponent: 2,
    documentRefs: [
      { resourceKind: 'fulfillment', entityInstanceId: work.entityInstanceId },
      { resourceKind: 'order', entityInstanceId: source.shipment.orderId },
    ],
    calculation: source.basis.calculation,
    accountResolution,
    contribution,
  })
  return {
    member: { workId, expectedBasisVersion: work.basisVersion, acceptedBasis },
    entry: source.entry,
    shipment: source.shipment,
  }
}

/** Acceptance callback re-reads all live dependencies rather than trusting the preview or saved basis. */
export async function revalidateFulfillmentMemberInTx(
  tx: Transaction,
  work: { organizationId: string; id: string },
  _basis: ReadyBasis
): Promise<AcceptedFulfillmentEffectBasisV1> {
  return (await prepareFulfillmentEffectMemberInTx(tx, work.organizationId, work.id)).member
    .acceptedBasis
}

/** Preserve rejected incoming financial evidence as deduplicated blocked correction work. */
export async function recordFulfillmentCorrectionObservationInTx(
  tx: Transaction,
  input: {
    organizationId: string
    fulfillmentInstanceId: string
    observation: Record<string, unknown>
  }
) {
  await withAccountingCommitLock(tx, input.organizationId)
  const observation = z.record(z.string(), z.json()).parse(input.observation)
  const [original] = await tx
    .select({ effectId: schema.AccountingEffect.id })
    .from(schema.AccountingEffect)
    .innerJoin(
      schema.AccountingWork,
      and(
        eq(schema.AccountingWork.id, schema.AccountingEffect.workId),
        eq(schema.AccountingWork.organizationId, input.organizationId),
        eq(schema.AccountingWork.operation, 'original')
      )
    )
    .where(
      and(
        eq(schema.AccountingEffect.organizationId, input.organizationId),
        eq(schema.AccountingWork.entityInstanceId, input.fulfillmentInstanceId)
      )
    )
  if (!original) throw new ConflictError('Correction observation requires accepted original work')
  const sourceHash = accountingBasisHash(observation)
  const effectKey = correctionAccountingEffectKey(
    original.effectId,
    'source_observation',
    sourceHash
  )
  const old = await tx.query.AccountingWork.findFirst({
    where: and(
      eq(schema.AccountingWork.organizationId, input.organizationId),
      eq(schema.AccountingWork.effectKey, effectKey)
    ),
  })
  if (old) return old
  const [work] = await tx
    .insert(schema.AccountingWork)
    .values({
      organizationId: input.organizationId,
      entityInstanceId: input.fulfillmentInstanceId,
      effectKind: 'fulfillment_accounting',
      effectKey,
      componentKey: sourceHash,
      operation: 'correction',
      correctsEffectId: original.effectId,
      basisVersion: 1,
      state: 'blocked',
      eligibility: 'manual',
      blockedReason: 'Changed source observation requires correction review',
    })
    .returning()
  if (!work) throw new Error('Correction observation insert returned no row')
  await tx.insert(schema.AccountingWorkBasis).values({
    organizationId: input.organizationId,
    workId: work.id,
    version: 1,
    sourceHash,
    effectiveDate: null,
    basis: {
      version: 1,
      status: 'incomplete',
      fulfillmentInstanceId: input.fulfillmentInstanceId,
      sourceHash,
      effectiveDate: null,
      missingDependencies: ['Explicit correction approval and delta calculation'],
      observed: observation,
    },
  })
  return work
}

/** Bounded, cursor-based discovery repairs a missing queue notification or initial work capture. */
export async function discoverFulfillmentAccountingWork(
  db: Database,
  input: {
    organizationId: string
    afterId?: string
    limit?: number
  }
): Promise<{ scanned: number; workIds: string[]; nextCursor: string | null }> {
  const limit = Math.min(200, Math.max(1, input.limit ?? 100))
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .innerJoin(
      schema.EntityDefinition,
      and(
        eq(schema.EntityDefinition.id, schema.EntityInstance.entityDefinitionId),
        eq(schema.EntityDefinition.organizationId, input.organizationId),
        eq(schema.EntityDefinition.entityType, 'fulfillment')
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, input.organizationId),
        isNull(schema.EntityInstance.archivedAt),
        ...(input.afterId ? [sql`${schema.EntityInstance.id} > ${input.afterId}`] : [])
      )
    )
    .orderBy(asc(schema.EntityInstance.id))
    .limit(limit)
  const workIds: string[] = []
  for (const row of rows) {
    const work = await db.transaction((tx) =>
      captureFulfillmentAccountingWorkInTx(tx, {
        organizationId: input.organizationId,
        fulfillmentInstanceId: row.id,
      })
    )
    workIds.push(work.id)
  }
  return {
    scanned: rows.length,
    workIds,
    nextCursor: rows.length === limit ? rows.at(-1)!.id : null,
  }
}
