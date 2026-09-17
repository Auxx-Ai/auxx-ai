// packages/lib/src/money/customer-money/recognition-source.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { UnprocessableEntityError } from '../../errors'
import { scaleLineTax } from '../../postings/build-fulfillment-batch-entry'
import { computeShipmentTotals } from '../../postings/build-fulfillment-entry'
import { periodKeyForDate } from '../../postings/periods'
import { loadFulfillmentFieldContext } from '../fulfillments/reads'
import { readOrderMoneyCoverage } from './reads'
import {
  allocateOrderRecognition,
  allocateRecognitionTaxComponents,
  type OrderRecognitionAllocation,
  type OrderRecognitionEvent,
} from './recognition'
import { readOrderRecognitionFactsInTx } from './recognition-facts'

type Db = Database | Transaction

/** Facts needed to replay one order's receipt and shipment timeline. */
export interface OrderRecognitionSource {
  organizationId: string
  orderId: string
  orderNetMinor: string
  orderTaxMinor: string
  events: OrderRecognitionEvent[]
  allocations: OrderRecognitionAllocation[]
  target: OrderRecognitionAllocation | null
  targetTaxComponents:
    | {
        componentKey: string
        amountMinor: string
        jurisdiction: string | null
        collector: 'merchant' | 'marketplace'
        remitter: 'merchant' | 'marketplace'
        withholdingEvidenceId: string | null
      }[]
    | null
  blockers: string[]
  sourceStoreId: string | null
  coverage: { complete: boolean; fetched: number; accepted: number; pending: number }
}

interface BasisCalculation {
  orderInstanceId?: string
  fulfillmentInstanceId?: string
  shippedOn?: string
  orderSubtotalMinor?: string
  orderTaxMinor?: string
  orderShippingMinor?: string
  priorShipmentSubtotalMinor?: string
  includeShipping?: boolean
  amountMinor?: string
  depositDebitMinor?: string
  receivableDebitMinor?: string
  newlyRecognizedTaxMinor?: string
  historyHash?: string
  taxComponents?: Array<{ componentKey?: string; amountMinor?: string }>
  lines?: Array<{
    orderLineId?: string
    quantity?: string
    orderedQuantity?: string
    priorShippedQuantity?: string
    netUnitMinor?: string
    netLineMinor?: string | null
    lineTaxMinor?: string | null
  }>
}

function integer(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value))
    throw new Error(`${label} is missing exact minor-unit evidence`)
  return BigInt(value)
}

function decimal(value: unknown, label: string): number {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value))
    throw new Error(`${label} is missing an exact quantity or rate`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} exceeds the numeric boundary`)
  return parsed
}

function safeMinorNumber(value: unknown, label: string): number {
  const parsed = integer(value, label)
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(`${label} exceeds the supported ledger numeric boundary`)
  return Number(parsed)
}

/** Normalize a stored PostgreSQL or ISO timestamp without inventing a time for a date. */
export function sourceOccurrence(raw: unknown, label: string): string {
  if (
    typeof raw !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(raw)
  )
    throw new UnprocessableEntityError(`${label} has no source occurrence instant`)
  const value = new Date(raw.replace(/([+-]\d{2})$/, '$1:00'))
  if (!Number.isFinite(value.getTime()))
    throw new UnprocessableEntityError(`${label} occurrence instant is invalid`)
  return value.toISOString()
}

function eventPrecedes(left: OrderRecognitionEvent, right: OrderRecognitionEvent): boolean {
  const time = Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
  if (time !== 0) return time < 0
  if (left.kind !== right.kind) return left.kind === 'receipt'
  return left.id.localeCompare(right.id) < 0
}

function asBasis(value: unknown): { calculation?: BasisCalculation; policyKey?: string } {
  if (value === null || typeof value !== 'object') return {}
  const row = value as Record<string, unknown>
  const nested =
    row.basis !== null && typeof row.basis === 'object'
      ? (row.basis as Record<string, unknown>)
      : undefined
  return {
    calculation: (row.calculation ?? nested?.calculation) as BasisCalculation | undefined,
    policyKey:
      typeof row.policyKey === 'string'
        ? row.policyKey
        : typeof nested?.policyKey === 'string'
          ? nested.policyKey
          : undefined,
  }
}

/** Recompute shipment economic amounts from frozen line-level source evidence. */
export function shipmentEconomicAmounts(calculation: BasisCalculation) {
  if (!calculation.lines?.length) throw new Error('Shipment source has no line net evidence')
  if (calculation.lines.some((line) => line.netLineMinor == null))
    throw new Error('Shipment source is missing line_item_net_total evidence')
  const totals = computeShipmentTotals({
    label: `fulfillment ${calculation.fulfillmentInstanceId ?? 'unknown'}`,
    lines: calculation.lines.map((line, index) => ({
      lineId: line.orderLineId ?? `line-${index}`,
      quantity: decimal(line.quantity, 'Shipment quantity'),
      orderedQuantity: decimal(line.orderedQuantity, 'Ordered quantity'),
      priorShippedQuantity: decimal(line.priorShippedQuantity, 'Prior shipped quantity'),
      unitPriceMinor: decimal(line.netUnitMinor, 'Net unit amount'),
      lineTotalMinor: safeMinorNumber(line.netLineMinor, 'Line net amount'),
      taxMinor:
        line.lineTaxMinor == null
          ? null
          : scaleLineTax(
              {
                lineId: line.orderLineId ?? `line-${index}`,
                lineTaxMinor: safeMinorNumber(line.lineTaxMinor, 'Line tax amount'),
                quantity: decimal(line.quantity, 'Shipment quantity'),
                orderedQuantity: decimal(line.orderedQuantity, 'Ordered quantity'),
                priorShippedQuantity: decimal(line.priorShippedQuantity, 'Prior shipped quantity'),
              },
              `fulfillment ${calculation.fulfillmentInstanceId ?? 'unknown'}`
            ),
    })),
    orderSubtotalMinor: safeMinorNumber(calculation.orderSubtotalMinor, 'Order subtotal'),
    orderTaxTotalMinor: safeMinorNumber(calculation.orderTaxMinor, 'Order tax'),
    orderShippingTotalMinor: safeMinorNumber(calculation.orderShippingMinor, 'Order shipping'),
    priorShipmentsSubtotalMinor: safeMinorNumber(
      calculation.priorShipmentSubtotalMinor,
      'Prior shipment subtotal'
    ),
    includeShipping: calculation.includeShipping === true,
  })
  return {
    netMinor: BigInt(totals.subtotalMinor + totals.shippingMinor),
    taxMinor: BigInt(totals.taxMinor),
  }
}

/** Read actual receipts and recorded shipments, including a current target event. */
export async function readOrderRecognitionSource(
  db: Db,
  input: {
    organizationId: string
    orderId: string
    orderNetMinor: string
    orderTaxMinor: string
    bookTimeZone: string
    target?: { kind: 'receipt' | 'fulfillment'; id: string }
    /** Current unaccepted event supplied by the fulfillment source reader. */
    targetEvent?: OrderRecognitionEvent
  }
): Promise<OrderRecognitionSource> {
  const blockers: string[] = []
  const [credit] = await db
    .select({ id: schema.AccountingEffect.id })
    .from(schema.AccountingEffect)
    .innerJoin(
      schema.AccountingWork,
      and(
        eq(schema.AccountingWork.organizationId, input.organizationId),
        eq(schema.AccountingWork.id, schema.AccountingEffect.workId)
      )
    )
    .where(
      and(
        eq(schema.AccountingEffect.organizationId, input.organizationId),
        eq(schema.AccountingWork.effectKind, 'customer_credit_issued'),
        eq(
          sql<string>`${schema.AccountingEffect.acceptedBasis}->'calculation'->>'orderInstanceId'`,
          input.orderId
        )
      )
    )
    .limit(1)
  if (credit)
    blockers.push(
      'Order recognition must include its accepted credit components before further posting'
    )
  let recognitionFacts: Awaited<ReturnType<typeof readOrderRecognitionFactsInTx>> | null = null
  try {
    recognitionFacts = await readOrderRecognitionFactsInTx(db, input.organizationId, input.orderId)
    if (
      recognitionFacts.subtotal + recognitionFacts.shipping !== BigInt(input.orderNetMinor) ||
      recognitionFacts.tax !== BigInt(input.orderTaxMinor)
    )
      blockers.push('Canonical order facts differ from the recognition source input')
  } catch (error) {
    if (!(error instanceof UnprocessableEntityError)) throw error
    blockers.push(error.message)
  }
  const [coverage, accepted] = await Promise.all([
    readOrderMoneyCoverage(db, input.organizationId, input.orderId),
    db.query.FinancialSourceAcceptance.findMany({
      where: and(
        eq(schema.FinancialSourceAcceptance.organizationId, input.organizationId),
        eq(schema.FinancialSourceAcceptance.orderInstanceId, input.orderId)
      ),
      columns: { orderExternalId: true, sourceObjectId: true, state: true },
    }),
  ])
  const sourceObjects = accepted.length
    ? await db.query.FinancialSourceObject.findMany({
        where: and(
          eq(schema.FinancialSourceObject.organizationId, input.organizationId),
          inArray(schema.FinancialSourceObject.id, [
            ...new Set(accepted.map((row) => row.sourceObjectId)),
          ])
        ),
        columns: { id: true, sourceAccountId: true },
      })
    : []
  const sourceAccountIds = [...new Set(sourceObjects.map((row) => row.sourceAccountId))]
  const sourceAccounts = sourceAccountIds.length
    ? await db.query.FinancialSourceAccount.findMany({
        where: and(
          eq(schema.FinancialSourceAccount.organizationId, input.organizationId),
          inArray(schema.FinancialSourceAccount.id, sourceAccountIds)
        ),
        columns: { id: true, environment: true, archivedAt: true, providerKey: true },
      })
    : []
  if (
    sourceAccountIds.length !== sourceAccounts.length ||
    sourceAccounts.some(
      (account) =>
        account.environment !== 'live' ||
        account.archivedAt !== null ||
        !coverage.sourceStoreIds.includes(account.id)
    )
  )
    blockers.push('Source transaction evidence is not from one live source account')
  const sourceStoreIds = [...new Set(sourceObjects.map((row) => row.sourceAccountId))]
  if (sourceStoreIds.length > 1)
    blockers.push('Source transaction evidence spans multiple source stores')
  if (!coverage.complete) blockers.push('Source transaction coverage is incomplete or unresolved')
  if (coverage.sourceStoreIds.length > 1)
    blockers.push('Source transaction evidence spans multiple source stores')
  if (
    accepted.some(
      (row) => row.state === 'pending' || row.state === 'blocked' || row.state === 'rejected'
    )
  )
    blockers.push('Source transaction evidence is pending, blocked, or rejected')

  const allApplications = await db.query.MoneyApplication.findMany({
    where: and(
      eq(schema.MoneyApplication.organizationId, input.organizationId),
      eq(schema.MoneyApplication.orderInstanceId, input.orderId)
    ),
    orderBy: asc(schema.MoneyApplication.createdAt),
  })
  const applications = allApplications.filter((row) => row.operation === 'apply')
  if (allApplications.some((row) => row.operation === 'unapply'))
    blockers.push('Receipt timeline contains an unapplied money application')
  const moneyIds = [...new Set(applications.map((row) => row.moneyTransactionId))]
  const moneyRows = moneyIds.length
    ? await db.query.MoneyTransaction.findMany({
        where: and(
          eq(schema.MoneyTransaction.organizationId, input.organizationId),
          inArray(schema.MoneyTransaction.id, moneyIds),
          eq(schema.MoneyTransaction.purpose, 'customer_receipt')
        ),
      })
    : []
  if (moneyIds.length) {
    const refunds = await db.query.MoneyRefundSettlement.findMany({
      where: and(
        eq(schema.MoneyRefundSettlement.organizationId, input.organizationId),
        inArray(schema.MoneyRefundSettlement.originalTransactionId, moneyIds)
      ),
      columns: { originalTransactionId: true },
    })
    for (const refund of refunds)
      blockers.push(`receipt ${refund.originalTransactionId} has a refund settlement`)
  }
  const moneyById = new Map(moneyRows.map((row) => [row.id, row]))
  const events: OrderRecognitionEvent[] = []
  for (const application of applications) {
    const money = moneyById.get(application.moneyTransactionId)
    if (!money) {
      blockers.push(`missing receipt ${application.moneyTransactionId}`)
      continue
    }
    if (money.currency !== 'USD' || money.currencyExponent !== 2)
      blockers.push(`receipt ${money.id} is outside the supported USD ledger`)
    if (!money.occurredAt) {
      blockers.push(`receipt ${money.id} has no occurrence instant`)
      continue
    }
    if (application.effectiveDate !== periodKeyForDate(money.occurredAt, 'day', input.bookTimeZone))
      blockers.push(`receipt ${money.id} application date differs from its book date`)
    if (application.amountMinor !== money.amountMinor)
      blockers.push(`receipt ${money.id} is partially applied and needs split effect ownership`)
    events.push({
      id: money.id,
      kind: 'receipt',
      effectiveDate: application.effectiveDate,
      occurredAt: money.occurredAt.toISOString(),
      amountMinor: application.amountMinor.toString(),
    })
  }

  const fulfillmentContext = await loadFulfillmentFieldContext(input.organizationId, db)
  const fulfillmentOrderRows = fulfillmentContext
    ? await db
        .select({ id: schema.FieldValue.entityId })
        .from(schema.FieldValue)
        .innerJoin(
          schema.EntityInstance,
          and(
            eq(schema.EntityInstance.organizationId, input.organizationId),
            eq(schema.EntityInstance.id, schema.FieldValue.entityId),
            eq(schema.EntityInstance.entityDefinitionId, fulfillmentContext.fulfillmentDefId),
            isNull(schema.EntityInstance.archivedAt)
          )
        )
        .where(
          and(
            eq(schema.FieldValue.organizationId, input.organizationId),
            eq(schema.FieldValue.fieldId, fulfillmentContext.fulfillment.fulfillment_order!.id),
            eq(schema.FieldValue.relatedEntityId, input.orderId)
          )
        )
    : []
  const fulfillmentIds = fulfillmentOrderRows.map((row) => row.id)
  if (fulfillmentIds.length && fulfillmentContext?.fulfillment.fulfillment_status) {
    const canceled = await db.query.FieldValue.findFirst({
      where: and(
        eq(schema.FieldValue.organizationId, input.organizationId),
        inArray(schema.FieldValue.entityId, fulfillmentIds),
        eq(schema.FieldValue.fieldId, fulfillmentContext.fulfillment.fulfillment_status.id),
        eq(schema.FieldValue.optionId, 'cancelled')
      ),
    })
    if (canceled)
      blockers.push('Canceled shipment evidence requires explicit cancellation accounting')
  }

  const fulfillmentRows =
    fulfillmentContext && fulfillmentIds.length
      ? await db
          .select({ id: schema.FieldValue.entityId, occurredAt: schema.FieldValue.valueDate })
          .from(schema.FieldValue)
          .where(
            and(
              eq(schema.FieldValue.organizationId, input.organizationId),
              inArray(schema.FieldValue.entityId, fulfillmentIds),
              eq(
                schema.FieldValue.fieldId,
                fulfillmentContext.fulfillment.fulfillment_shipped_at?.id ?? ''
              )
            )
          )
      : []
  if (!fulfillmentContext) blockers.push('Fulfillment source fields are unresolved')
  const datedFulfillmentIds = new Set(fulfillmentRows.map((row) => row.id))
  for (const fulfillmentId of fulfillmentIds)
    if (!datedFulfillmentIds.has(fulfillmentId))
      blockers.push(`fulfillment ${fulfillmentId} has no source shipment occurrence instant`)
  const works = fulfillmentIds.length
    ? await db.query.AccountingWork.findMany({
        where: and(
          eq(schema.AccountingWork.organizationId, input.organizationId),
          inArray(schema.AccountingWork.entityInstanceId, fulfillmentIds),
          eq(schema.AccountingWork.effectKind, 'fulfillment_accounting'),
          eq(schema.AccountingWork.operation, 'original')
        ),
      })
    : []
  const workByFulfillment = new Map(works.map((work) => [work.entityInstanceId, work]))
  const basisRows = works.length
    ? await db.query.AccountingWorkBasis.findMany({
        where: and(
          eq(schema.AccountingWorkBasis.organizationId, input.organizationId),
          inArray(
            schema.AccountingWorkBasis.workId,
            works.map((work) => work.id)
          )
        ),
      })
    : []
  const basisByWork = new Map(
    basisRows.map((basis) => [`${basis.workId}:${basis.version}`, basis.basis])
  )
  const effects = works.length
    ? await db.query.AccountingEffect.findMany({
        where: and(
          eq(schema.AccountingEffect.organizationId, input.organizationId),
          inArray(
            schema.AccountingEffect.workId,
            works.map((work) => work.id)
          )
        ),
      })
    : []
  const effectByWork = new Map(effects.map((effect) => [effect.workId, effect]))
  const targetOccurrence =
    input.target?.kind === 'fulfillment'
      ? fulfillmentRows.find((row) => row.id === input.target?.id)?.occurredAt
      : undefined
  const normalizedTargetEvent =
    input.targetEvent &&
    input.target?.kind === 'fulfillment' &&
    input.targetEvent.kind === 'fulfillment' &&
    input.targetEvent.id === input.target.id &&
    targetOccurrence
      ? {
          ...input.targetEvent,
          occurredAt: sourceOccurrence(targetOccurrence, 'Target shipment'),
          effectiveDate: periodKeyForDate(
            new Date(sourceOccurrence(targetOccurrence, 'Target shipment')),
            'day',
            input.bookTimeZone
          ),
        }
      : undefined
  const targetTimelineEvent =
    normalizedTargetEvent ??
    (input.target
      ? events.find((event) => event.kind === input.target!.kind && event.id === input.target!.id)
      : undefined)
  const appendShipment = (
    id: string,
    calculation: BasisCalculation,
    effectiveDate: string,
    occurredAtRaw: unknown
  ) => {
    if (!calculation.fulfillmentInstanceId || calculation.orderInstanceId !== input.orderId)
      throw new Error(`fulfillment ${id} has an invalid accepted source basis`)
    const amounts = shipmentEconomicAmounts(calculation)
    const occurredAt = sourceOccurrence(occurredAtRaw, `fulfillment ${id}`)
    const bookDate = periodKeyForDate(new Date(occurredAt), 'day', input.bookTimeZone)
    if (calculation.shippedOn !== bookDate || effectiveDate !== bookDate)
      throw new Error(`fulfillment ${id} accounting date differs from its source occurrence`)
    events.push({
      id,
      kind: 'fulfillment',
      effectiveDate: bookDate,
      occurredAt,
      netMinor: amounts.netMinor.toString(),
      taxMinor: amounts.taxMinor.toString(),
    })
    return Date.parse(occurredAt)
  }
  for (const row of fulfillmentRows) {
    const work = workByFulfillment.get(row.id)
    const effect = work ? effectByWork.get(work.id) : undefined
    if (!work || !effect) {
      if (input.target?.kind === 'fulfillment' && input.target.id === row.id) {
        if (
          input.target?.kind === 'fulfillment' &&
          input.target.id === row.id &&
          normalizedTargetEvent
        ) {
          events.push(normalizedTargetEvent)
        } else if (!work) {
          blockers.push(`target fulfillment ${row.id} has no accounting work`)
        } else {
          const pendingBasis = asBasis(basisByWork.get(`${work.id}:${work.basisVersion}`))
          if (!pendingBasis.calculation)
            blockers.push(`target fulfillment ${row.id} has incomplete accounting source evidence`)
          else {
            try {
              appendShipment(
                row.id,
                pendingBasis.calculation,
                row.occurredAt?.slice(0, 10) ?? '',
                row.occurredAt
              )
            } catch (error) {
              blockers.push(error instanceof Error ? error.message : String(error))
            }
          }
        }
      } else if (
        targetTimelineEvent &&
        eventPrecedes(
          {
            id: row.id,
            kind: 'fulfillment',
            effectiveDate: row.occurredAt?.slice(0, 10) ?? '',
            occurredAt: sourceOccurrence(row.occurredAt, `fulfillment ${row.id}`),
            netMinor: '0',
            taxMinor: '0',
          },
          targetTimelineEvent
        )
      ) {
        blockers.push(`earlier shipment accounting pending for fulfillment ${row.id}`)
      }
      continue
    }
    const basis = asBasis(effect.acceptedBasis)
    if (basis.policyKey !== 'shopify_payment_date_v1') {
      blockers.push(`fulfillment ${row.id} uses a legacy fulfillment accounting policy`)
      continue
    }
    const calculation = basis.calculation
    if (!calculation) {
      blockers.push(`fulfillment ${row.id} has an invalid accepted source basis`)
      continue
    }
    try {
      appendShipment(row.id, calculation, effect.effectiveDate, row.occurredAt)
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : String(error))
    }
  }

  let allocations: OrderRecognitionAllocation[] = []
  if (blockers.length === 0) {
    try {
      allocations = allocateOrderRecognition({
        orderNetMinor: input.orderNetMinor,
        orderTaxMinor: input.orderTaxMinor,
        events,
      })
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (allocations.length && moneyIds.length) {
    const receiptWorks = await db.query.AccountingWork.findMany({
      where: and(
        eq(schema.AccountingWork.organizationId, input.organizationId),
        inArray(schema.AccountingWork.moneyTransactionId, moneyIds),
        eq(schema.AccountingWork.effectKind, 'customer_receipt'),
        eq(schema.AccountingWork.operation, 'original')
      ),
    })
    const receiptEffects = receiptWorks.length
      ? await db.query.AccountingEffect.findMany({
          where: and(
            eq(schema.AccountingEffect.organizationId, input.organizationId),
            inArray(
              schema.AccountingEffect.workId,
              receiptWorks.map((work) => work.id)
            )
          ),
        })
      : []
    const receiptEffectByMoney = new Map(
      receiptWorks.map((work) => [
        work.moneyTransactionId,
        receiptEffects.find((effect) => effect.workId === work.id),
      ])
    )
    const targetEvent = input.target
      ? events.find((event) => event.kind === input.target?.kind && event.id === input.target.id)
      : undefined
    for (const event of events) {
      if (event.kind !== 'receipt' || event.id === input.target?.id) continue
      if (targetEvent && eventPrecedes(event, targetEvent) && !receiptEffectByMoney.get(event.id))
        blockers.push(`earlier receipt accounting pending for receipt ${event.id}`)
    }
    for (const allocation of allocations) {
      if (allocation.kind !== 'receipt') continue
      const effect = receiptEffectByMoney.get(allocation.id)
      if (!effect) continue
      const calculation = asBasis(effect.acceptedBasis).calculation as
        | (BasisCalculation & {
            moneyTransactionId?: string
            historyHash?: string
            amountMinor?: string
            receiptAmountMinor?: string
            allocation?: {
              amountMinor?: string
              depositMinor?: string
              receivableMinor?: string
              taxMinor?: string
            }
          })
        | undefined
      if (
        !calculation ||
        calculation.moneyTransactionId !== allocation.id ||
        calculation.historyHash !== allocation.historyHash ||
        calculation.amountMinor !== allocation.amountMinor ||
        calculation.receiptAmountMinor !== allocation.amountMinor ||
        calculation.allocation?.amountMinor !== allocation.amountMinor ||
        calculation.allocation?.depositMinor !== allocation.depositMinor ||
        calculation.allocation?.receivableMinor !== allocation.receivableMinor ||
        calculation.allocation?.taxMinor !== allocation.taxMinor
      )
        blockers.push(
          `accepted receipt ${allocation.id} no longer matches the recognition timeline`
        )
    }
  }
  if (allocations.length && blockers.length === 0) {
    for (const allocation of allocations) {
      if (allocation.kind !== 'fulfillment') continue
      const work = workByFulfillment.get(allocation.id)
      const effect = work ? effectByWork.get(work.id) : undefined
      if (!effect) continue
      const calculation = asBasis(effect.acceptedBasis).calculation as
        | (BasisCalculation & {
            recognitionAllocation?: {
              amountMinor?: string
              depositDebitMinor?: string
              receivableDebitMinor?: string
              newlyRecognizedTaxMinor?: string
              historyHash?: string
            }
          })
        | undefined
      const stored = calculation?.recognitionAllocation
      const frozen = {
        amountMinor: stored?.amountMinor,
        depositMinor: stored?.depositDebitMinor,
        receivableMinor: stored?.receivableDebitMinor,
        taxMinor: stored?.newlyRecognizedTaxMinor,
        historyHash: stored?.historyHash,
      }
      if (
        !frozen ||
        frozen.amountMinor !== allocation.amountMinor ||
        frozen.depositMinor !== allocation.depositMinor ||
        frozen.receivableMinor !== allocation.receivableMinor ||
        frozen.taxMinor !== allocation.taxMinor ||
        frozen.historyHash !== allocation.historyHash
      )
        blockers.push(
          `accepted fulfillment ${allocation.id} no longer matches the recognition timeline`
        )
    }
  }
  const target = input.target
    ? (allocations.find((row) => row.kind === input.target!.kind && row.id === input.target!.id) ??
      null)
    : null
  const componentAllocations =
    allocations.length && recognitionFacts && !blockers.length
      ? allocateRecognitionTaxComponents(allocations, recognitionFacts.taxComponents)
      : new Map<string, { componentKey: string; amountMinor: string }[]>()
  const factsComponents = new Map(
    recognitionFacts?.taxComponents.map((component) => [component.componentKey, component]) ?? []
  )
  const targetTaxComponents = input.target
    ? (componentAllocations.get(input.target.id)?.map((component) => ({
        ...component,
        jurisdiction: factsComponents.get(component.componentKey)?.jurisdiction ?? null,
        collector: factsComponents.get(component.componentKey)?.collector ?? 'merchant',
        remitter: factsComponents.get(component.componentKey)?.remitter ?? 'merchant',
        withholdingEvidenceId:
          factsComponents.get(component.componentKey)?.withholdingEvidenceId ?? null,
      })) ?? null)
    : null
  if (allocations.length && recognitionFacts && !blockers.length) {
    const componentByEvent = allocateRecognitionTaxComponents(
      allocations,
      recognitionFacts.taxComponents
    )
    for (const allocation of allocations) {
      if (allocation.kind !== 'fulfillment') continue
      const work = workByFulfillment.get(allocation.id)
      const effect = work ? effectByWork.get(work.id) : undefined
      if (!effect) continue
      const calculation = asBasis(effect.acceptedBasis).calculation
      const expected = componentByEvent.get(allocation.id) ?? []
      const stored = calculation?.taxComponents ?? []
      const matches =
        stored.length === expected.length &&
        expected.every((component, index) => {
          const row = stored[index]
          return (
            row?.componentKey === component.componentKey &&
            row.amountMinor === component.amountMinor
          )
        })
      if (!matches)
        blockers.push(
          `accepted fulfillment ${allocation.id} no longer matches tax component allocation`
        )
    }
  }
  if (input.target && !target && blockers.length === 0)
    blockers.push(
      `target ${input.target.kind} ${input.target.id} is absent from the recognition timeline`
    )
  return {
    organizationId: input.organizationId,
    orderId: input.orderId,
    orderNetMinor: input.orderNetMinor,
    orderTaxMinor: input.orderTaxMinor,
    events,
    allocations,
    target,
    targetTaxComponents,
    blockers: [...new Set(blockers)],
    sourceStoreId:
      sourceStoreIds.length === 1
        ? sourceStoreIds[0]!
        : coverage.sourceStoreIds.length === 1
          ? coverage.sourceStoreIds[0]!
          : null,
    coverage: {
      complete: coverage.complete,
      fetched: coverage.fetched,
      accepted: coverage.accepted,
      pending: coverage.pending,
    },
  }
}

/** Refuse a timeline before using any event allocation as authoritative. */
export function requireCompleteOrderRecognitionSource(source: OrderRecognitionSource) {
  if (source.blockers.length)
    throw new UnprocessableEntityError(
      `Order recognition timeline is incomplete: ${source.blockers.join('; ')}`
    )
  return source
}
