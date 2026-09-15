// packages/lib/src/money/fulfillment-posting/reads.ts

/** Fulfillment eligibility is the absence of accepted original membership.
 * Legacy stamps are retained as repair blockers, never treated as a new claim.
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import type { FieldOptions } from '../../field-values/converters'
import { computeShipmentAmounts } from '../../postings/build-fulfillment-batch-entry'
import { resolvePeriodLock } from '../../postings/period-lock'
import { LEDGER_CURRENCY } from '../../postings/post-entry'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import { buildOptionIndex, resolveOptionId } from '../../resources/registry/option-helpers'
import { getOrganizationSetting } from '../../settings/settings-service'
import { readOrderMoneyCoverage } from '../customer-money/reads'
import { readOrderRecognitionSource } from '../customer-money/recognition-source'
import {
  type Fulfillment,
  type FulfillmentFieldContext,
  isLiveFulfillment,
  loadFulfillmentFieldContext,
  readFulfillmentsForOrder,
  readFulfillmentsForOrders,
} from '../fulfillments'
import { netLineTotalMinor, netUnitPriceMinor } from '../orders/client'
import {
  type OrderFieldContext,
  readOrderTaxLines,
  requireOrderFieldContext,
} from '../orders/reads'
import { guard } from './guard'
import { loadGatewayRoutesForPlan, planFulfillmentPosting } from './plan'
import type {
  FulfillmentPostingExclusionReason,
  FulfillmentPostingPlan,
  OrderFulfillmentPostingRef,
  UnpostedShipment,
  UnpostedShipmentLine,
} from './types'

/** Half-open on `shippedAt`: `from <= shippedAt < to`, both `YYYY-MM-DD`. */
export interface UnpostedShipmentRange {
  from: string
  to: string
}

/** `YYYY-MM-DD`, and nothing else. A range bound is a contract, not a hint. */
function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new UnprocessableEntityError(`${label} must be a YYYY-MM-DD date, got "${value}"`)
  }
}

/** `YYYY-MM`, and nothing else. */
function assertMonth(value: string, label: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new UnprocessableEntityError(`${label} must be a YYYY-MM month, got "${value}"`)
  }
}

/** The half-open day range one calendar month covers. Validated by {@link assertMonth}. */
function monthRange(month: string): UnpostedShipmentRange {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(5, 7))
  const nextYear = index === 12 ? year + 1 : year
  const nextIndex = index === 12 ? 1 : index + 1
  return { from: `${month}-01`, to: `${nextYear}-${String(nextIndex).padStart(2, '0')}-01` }
}

/** `fulfillment_shipped_at` is an ISO instant; the accounting date is its day. */
export function toCalendarDay(raw: string | null | undefined, timeZone = 'UTC'): string | null {
  if (typeof raw !== 'string') return null
  const instant = new Date(raw)
  if (!Number.isFinite(instant.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** One `fulfillment` in the range with no accepted original effect, and the order it belongs to. */
interface FulfillmentCandidate {
  fulfillmentId: string
  orderId: string
}

/** Find dated original obligations with no accepted effect, independent of mutable posting stamps. */
async function readUnpostedFulfillmentCandidates(
  db: Database | Transaction,
  organizationId: string,
  ctx: FulfillmentFieldContext,
  range: UnpostedShipmentRange,
  fulfillmentIds?: readonly string[]
): Promise<FulfillmentCandidate[]> {
  const shippedAtField = ctx.fulfillment.fulfillment_shipped_at
  const orderField = ctx.fulfillment.fulfillment_order
  if (!shippedAtField || !orderField) return []
  const glPostingFieldId = ctx.fulfillment.fulfillment_gl_posting?.id ?? ''
  const zone =
    (await readTextSetting(db, organizationId, OPENING_BASELINE_SETTING_KEYS.bookTimeZone)) ?? 'UTC'
  const bookDay = sql`(${schema.FieldValue.valueDate} AT TIME ZONE ${zone})::date`

  const orderEdge = alias(schema.FieldValue, 'fulfillment_order_edge')
  const stamp = alias(schema.FieldValue, 'fulfillment_gl_posting_stamp')

  const rows = await db
    .select({
      fulfillmentId: schema.FieldValue.entityId,
      orderId: orderEdge.relatedEntityId,
    })
    .from(schema.FieldValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.FieldValue.entityId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .leftJoin(
      orderEdge,
      and(
        eq(orderEdge.organizationId, schema.FieldValue.organizationId),
        eq(orderEdge.entityId, schema.FieldValue.entityId),
        eq(orderEdge.fieldId, orderField.id)
      )
    )
    .leftJoin(
      stamp,
      and(
        eq(stamp.organizationId, schema.FieldValue.organizationId),
        eq(stamp.entityId, schema.FieldValue.entityId),
        eq(stamp.fieldId, glPostingFieldId)
      )
    )
    .leftJoin(
      schema.AccountingWork,
      and(
        eq(schema.AccountingWork.organizationId, organizationId),
        eq(schema.AccountingWork.entityInstanceId, schema.FieldValue.entityId),
        eq(schema.AccountingWork.effectKind, 'fulfillment_accounting'),
        eq(schema.AccountingWork.operation, 'original')
      )
    )
    .leftJoin(
      schema.AccountingEffect,
      and(
        eq(schema.AccountingEffect.organizationId, organizationId),
        eq(schema.AccountingEffect.workId, schema.AccountingWork.id)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, shippedAtField.id),
        sql`${bookDay} >= ${range.from}::date`,
        sql`${bookDay} < ${range.to}::date`,
        isNull(schema.AccountingEffect.id),
        ...(fulfillmentIds ? [inArray(schema.FieldValue.entityId, [...fulfillmentIds])] : [])
      )
    )
    .orderBy(asc(schema.FieldValue.valueDate), asc(schema.FieldValue.entityId))

  const seen = new Set<string>()
  const candidates: FulfillmentCandidate[] = []
  for (const row of rows) {
    // No `fulfillment_order` edge is unreachable by the registry (the field is
    // required), but dropped rather than crashing: a fulfillment with nowhere
    // to post has nothing this run can do with it.
    if (!row.orderId || seen.has(row.fulfillmentId)) continue
    seen.add(row.fulfillmentId)
    candidates.push({ fulfillmentId: row.fulfillmentId, orderId: row.orderId })
  }
  return candidates
}

/**
 * Every shipment in the range with no accepted original effect, with everything the
 * builder needs riding on it.
 *
 * An org with no provisioned `fulfillment` def reads as no shipments rather
 * than as an error: there is nothing to post, and a preview showing an empty
 * plan is the honest answer. The one refusal is a malformed period lock, which
 * `resolvePeriodLock` owns and which does not reach this function.
 *
 * @param range half-open on `shippedAt`, both `YYYY-MM-DD` in the book zone.
 */
export async function readUnpostedShipments(
  db: Database | Transaction,
  params: {
    organizationId: string
    range: UnpostedShipmentRange
    fulfillmentIds?: readonly string[]
  }
): Promise<Result<UnpostedShipment[], Error>> {
  const { organizationId, range } = params

  return guard(
    async () => {
      assertIsoDate(range.from, 'The range start')
      assertIsoDate(range.to, 'The range end')

      const fulfillmentCtx = await loadFulfillmentFieldContext(organizationId, db)
      if (!fulfillmentCtx) return []

      const candidates = await readUnpostedFulfillmentCandidates(
        db,
        organizationId,
        fulfillmentCtx,
        range,
        params.fulfillmentIds
      )
      if (candidates.length === 0) return []

      const candidateIds = new Set(
        candidates
          .filter(
            (row) => !params.fulfillmentIds || params.fulfillmentIds.includes(row.fulfillmentId)
          )
          .map((row) => row.fulfillmentId)
      )
      const orderIds = [...new Set(candidates.map((row) => row.orderId))]

      const [ctx, byOrder] = await Promise.all([
        requireOrderFieldContext(organizationId, db),
        readFulfillmentsForOrders(db, { organizationId, orderIds }),
      ])

      // Every line item a CANDIDATE fulfillment names - not every line of every
      // fulfillment, since the non-candidate ones (kept only to sum
      // `priorShipmentsSubtotalMinor`) contribute nothing else to the output.
      const lineIds = new Set<string>()
      for (const fulfillments of byOrder.values()) {
        for (const fulfillment of fulfillments) {
          if (!candidateIds.has(fulfillment.id)) continue
          for (const line of fulfillment.lines) lineIds.add(line.lineItemId)
        }
      }

      const bookTimeZone = await readTextSetting(
        db,
        organizationId,
        OPENING_BASELINE_SETTING_KEYS.bookTimeZone
      )
      const [orders, lines, taxLinesByOrder, moneyCoverage] = await Promise.all([
        readOrderFacts(db, organizationId, ctx, orderIds),
        readLineFacts(db, organizationId, ctx, [...lineIds]),
        // ONE bulk read for the whole batch, never per order (brief 13 §5).
        readOrderTaxLines(db, organizationId, orderIds),
        Promise.all(
          orderIds.map(
            async (orderId) =>
              [orderId, await readOrderMoneyCoverage(db, organizationId, orderId)] as const
          )
        ).then((rows) => new Map(rows)),
      ])

      const shipments: UnpostedShipment[] = []
      for (const [orderId, fulfillments] of byOrder) {
        const order = orders.get(orderId)
        // An order whose fields cannot be read at all is dropped rather than
        // posted from defaults: an entry built on a guessed subtotal balances
        // and is wrong, and nothing downstream could see it.
        if (!order) continue

        // Running sum in SEQUENCE order, over EVERY fulfillment of the order -
        // `fulfillments` is already sorted ascending by `readFulfillmentsForOrders`.
        // Added AFTER a candidate is emitted, so a shipment's own amount never
        // counts toward its own prior total - the same "1 PRECEDING" the old
        // window function enforced.
        let priorSubtotalMinor = 0
        // And per line, the UNITS those same earlier shipments took, for the
        // builder's cumulative allocation of each line's total (29 §12 item 6).
        // Same predicate as the subtotal below, so the two priors describe the
        // same set of shipments.
        const priorShippedByLine = new Map<string, number>()
        for (const fulfillment of fulfillments) {
          // 🛑 A CANCELLED fulfillment is never posted. This is new state the
          // JSON log could not carry: the connector's old `deriveFulfillments`
          // filtered `status !== 'cancelled'` BEFORE anything reached the log,
          // so a cancelled dispatch did not exist as far as lib was concerned.
          // It now arrives as a real record on purpose (a vanished record is
          // indistinguishable from one never seen, and the relief lane nets
          // against it), which means every consumer has to exclude it
          // deliberately. Posting one would recognise revenue for a dispatch
          // that never went out, and nothing downstream would object.
          const live = isLiveFulfillment(fulfillment)
          if (live && candidateIds.has(fulfillment.id)) {
            const shipment = buildShipment(
              fulfillment,
              order,
              priorSubtotalMinor,
              priorShippedByLine,
              lines,
              taxLinesByOrder.get(orderId) ?? [],
              bookTimeZone ?? 'UTC'
            )
            if (shipment) shipments.push(shipment)
          }
          // What EARLIER shipments recognised, which is what the cumulative tax
          // allocation trues itself up against. A cancelled fulfillment that was
          // never posted recognised nothing, so it must not inflate the running
          // total - but one that WAS posted before being cancelled did, and a
          // reversal never clears the stamp, so it still counts.
          if (live || fulfillment.glPosting !== null) {
            priorSubtotalMinor += fulfillment.subtotalMinor
            for (const line of fulfillment.lines) {
              priorShippedByLine.set(
                line.lineItemId,
                (priorShippedByLine.get(line.lineItemId) ?? 0) + line.quantity
              )
            }
          }
        }
      }

      // The switched policy replays one canonical timeline per order. Current
      // candidates are included beside accepted history before any allocation
      // is attached, so a partial receipt or split shipment gets numeric
      // ownership rather than a paid-status fork.
      const shipmentsByOrder = new Map<string, UnpostedShipment[]>()
      for (const shipment of shipments) {
        const list = shipmentsByOrder.get(shipment.orderId) ?? []
        list.push(shipment)
        shipmentsByOrder.set(shipment.orderId, list)
      }
      for (const [orderId, current] of shipmentsByOrder) {
        const order = orders.get(orderId)
        if (!order) continue
        const coverage = moneyCoverage.get(orderId)
        // Canonical source money evidence is an explicit cutover gate. An
        // order without a source account keeps the established arithmetic;
        // once evidence exists, incomplete coverage blocks rather than
        // silently falling back to financial status or gateway names.
        if (!coverage?.sourceAvailable) continue
        if (!coverage.complete || !bookTimeZone) {
          throw new UnprocessableEntityError(
            `Order ${orderId} source money coverage or book time zone is incomplete; ` +
              'fulfillment recognition is blocked.'
          )
        }
        for (const shipment of current) {
          const source = await readOrderRecognitionSource(db, {
            organizationId,
            orderId,
            orderNetMinor: String(order.subtotalMinor + order.shippingTotalMinor),
            orderTaxMinor: String(order.taxTotalMinor),
            bookTimeZone,
            target: { kind: 'fulfillment', id: shipment.fulfillmentInstanceId },
            targetEvent: (() => {
              const sourceAmounts = computeShipmentAmounts(shipment, 'accounts_receivable')
              return {
                id: shipment.fulfillmentInstanceId,
                kind: 'fulfillment' as const,
                effectiveDate: shipment.shippedAt,
                occurredAt: new Date(
                  byOrder.get(orderId)!.find((row) => row.id === shipment.fulfillmentInstanceId)!
                    .shippedAt
                ).toISOString(),
                netMinor: String(
                  sourceAmounts.subtotalMinor +
                    (shipment.includeShipping ? sourceAmounts.shippingMinor : 0)
                ),
                taxMinor: String(sourceAmounts.taxMinor),
              }
            })(),
          })
          if (source.blockers.length || !source.target) {
            throw new UnprocessableEntityError(
              `Order ${orderId} recognition timeline is incomplete: ` +
                (source.blockers.join('; ') ||
                  `no allocation for fulfillment ${shipment.fulfillmentInstanceId}`)
            )
          }
          shipment.recognitionAllocation = {
            amountMinor: Number(source.target.amountMinor),
            depositMinor: Number(source.target.depositMinor),
            receivableMinor: Number(source.target.receivableMinor),
            taxMinor: Number(source.target.taxMinor),
            historyHash: source.target.historyHash,
          }
          shipment.sourceStoreId = source.sourceStoreId
          shipment.processorRouteId = source.processorRouteId
          shipment.recognitionTaxComponents =
            source.targetTaxComponents?.map((component) => ({
              componentKey: component.componentKey,
              amountMinor: Number(component.amountMinor),
              jurisdiction: component.jurisdiction,
              collector: component.collector,
              remitter: component.remitter,
              withholdingEvidenceId: component.withholdingEvidenceId,
            })) ?? []
        }
      }

      shipments.sort(
        (a, b) =>
          compareStrings(a.shippedAt, b.shippedAt) ||
          compareStrings(a.orderId, b.orderId) ||
          a.sequence - b.sequence
      )
      return shipments
    },
    'Failed to read unposted shipments',
    { organizationId, from: range.from, to: range.to }
  )
}

/** One `UnpostedShipment`, from a candidate `Fulfillment` record and its order's facts. */
function buildShipment(
  fulfillment: Fulfillment,
  order: OrderFacts,
  priorShipmentsSubtotalMinor: number,
  priorShippedByLine: ReadonlyMap<string, number>,
  lineFacts: Map<
    string,
    Omit<UnpostedShipmentLine, 'lineId' | 'quantity' | 'priorShippedQuantity'>
  >,
  taxLines: readonly { title: string; priceMinor: number }[],
  timeZone: string
): UnpostedShipment | null {
  const shippedAt = toCalendarDay(fulfillment.shippedAt, timeZone)
  // Unreachable by contract (the netting query is itself anchored on this
  // field), but dropped rather than defaulted: a shipment with no date has no
  // period to post into and guessing one recognises revenue in the wrong month.
  if (!shippedAt) return null

  return {
    orderId: fulfillment.orderId,
    orderNumber: order.number,
    fulfillmentInstanceId: fulfillment.id,
    sequence: fulfillment.sequence,
    shippedAt,
    legacyPostingId: fulfillment.glPosting,
    lines: fulfillment.lines.map((line) => ({
      fulfillmentLineId: line.id,
      lineId: line.lineItemId,
      quantity: line.quantity,
      ...(lineFacts.get(line.lineItemId) ?? UNKNOWN_LINE),
      priorShippedQuantity: priorShippedByLine.get(line.lineItemId) ?? 0,
    })),
    channel: order.channel,
    currency: order.currency,
    financialStatus: order.financialStatus,
    gateways: order.gateways,
    orderSubtotalMinor: order.subtotalMinor,
    orderTaxTotalMinor: order.taxTotalMinor,
    orderShippingTotalMinor: order.shippingTotalMinor,
    priorShipmentsSubtotalMinor,
    includeShipping: fulfillment.shippingRecognised,
    contactId: order.contactId,
    taxLines,
  }
}

/**
 * Exclusion reasons that still block a month close.
 *
 * A shipment the plan excludes for one of these needs a person: a currency the
 * ledger cannot hold, a gateway nobody has resolved, test data that should not
 * be there. `zero-value` recognises nothing and blocks nothing, and
 * `before-cutoff` / `locked-period` describe months the close is not asking
 * about.
 */
export const CLOSE_BLOCKING_EXCLUSION_REASONS: ReadonlySet<FulfillmentPostingExclusionReason> =
  new Set(['foreign-currency', 'gateway-ambiguous', 'test-gateway'])

/** The close's count of a plan: what would post, plus what a person still owes. */
export function countCloseBlockingShipments(plan: FulfillmentPostingPlan): number {
  const owed = plan.exclusions.filter((e) => CLOSE_BLOCKING_EXCLUSION_REASONS.has(e.reason)).length
  return plan.footer.shipments + owed
}

/**
 * How many shipments in one book month still owe the ledger a posting.
 *
 * Lane D's close refusal reads this: a month that still holds an unposted
 * shipment is a month whose revenue is not on the P&L, and declaring it closed
 * would leave that revenue with nowhere to land (§2.4).
 *
 * Counted through the SAME read and the SAME plan the dialog uses, so "the
 * close says 3 and the dialog shows 2" is unreachable, and so a shipment the
 * dialog excludes for good ({@link CLOSE_BLOCKING_EXCLUSION_REASONS}) does not
 * hold the month open forever. The first drive on the dev org found exactly
 * that: one zero-value order kept July unclosable after every day had posted.
 */
export async function countUnpostedShipments(
  db: Database | Transaction,
  params: { organizationId: string; month: string }
): Promise<Result<number, Error>> {
  const { organizationId, month } = params

  return guard(
    async () => {
      assertMonth(month, 'The month')
      const shipments = await readUnpostedShipments(db, {
        organizationId,
        range: monthRange(month),
      })
      if (shipments.isErr()) throw shipments.error
      if (shipments.value.length === 0) return 0
      const [settings, gatewayRoutes] = await Promise.all([
        readFulfillmentPostingSettings(db, organizationId),
        loadGatewayRoutesForPlan(db, organizationId),
      ])
      if (settings.isErr()) throw settings.error
      const plan = planFulfillmentPosting({
        shipments: shipments.value,
        gatewayRoutes,
        grouping: 'day',
        cutoffPeriod: settings.value.cutoffPeriod,
        lockedThroughMonth: settings.value.lockedThroughMonth,
        ledgerCurrency: settings.value.ledgerCurrency,
        timeZone: settings.value.timeZone ?? 'UTC',
      })
      return countCloseBlockingShipments(plan)
    },
    'Failed to count unposted shipments',
    { organizationId, month }
  )
}

/**
 * The postings one order's fulfillments name, with each posting's CURRENT
 * status.
 *
 * 🛑 The order's ledger card reads this instead of `listPostingsForSource`
 * (§8.2). A batch entry carries per-order source lines only for the A/R leg of
 * a terms order; a card order's legs summarise under
 * `sourceType: 'fulfillment_batch'`, so a source-line lookup finds nothing for
 * the majority of Shopify orders and the card renders empty over an order that
 * is perfectly well posted.
 *
 * A stamp naming a posting that no longer exists is dropped rather than
 * rendered as a broken link.
 */
export async function listOrderFulfillmentPostings(
  db: Database | Transaction,
  params: { organizationId: string; orderId: string }
): Promise<Result<OrderFulfillmentPostingRef[], Error>> {
  const { organizationId, orderId } = params

  return guard(
    async () => {
      const fulfillments = await readFulfillmentsForOrder(db, { organizationId, orderId })
      const stamped = fulfillments.filter(
        (fulfillment): fulfillment is Fulfillment & { glPosting: string } =>
          fulfillment.glPosting !== null
      )
      if (stamped.length === 0) return []

      const postings = await db
        .select({
          id: schema.GlPosting.id,
          docNumber: schema.GlPosting.docNumber,
          status: schema.GlPosting.status,
        })
        .from(schema.GlPosting)
        .where(
          and(
            eq(schema.GlPosting.organizationId, organizationId),
            inArray(
              schema.GlPosting.id,
              stamped.map((fulfillment) => fulfillment.glPosting)
            )
          )
        )
      const byId = new Map(postings.map((posting) => [posting.id, posting]))

      const refs: OrderFulfillmentPostingRef[] = []
      for (const fulfillment of stamped) {
        const posting = byId.get(fulfillment.glPosting)
        if (!posting) continue
        const shippedAt = toCalendarDay(fulfillment.shippedAt) ?? fulfillment.shippedAt
        refs.push({
          sequence: fulfillment.sequence,
          shippedAt,
          glPostingId: fulfillment.glPosting,
          docNumber: posting.docNumber ?? null,
          status: posting.status,
        })
      }
      return refs.sort((a, b) => a.sequence - b.sequence)
    },
    'Failed to read an order fulfillment postings',
    { organizationId, orderId }
  )
}

/** Everything the plan needs that is an organization setting rather than a fact. */
export interface FulfillmentPostingSettings {
  /** `accounting.cutoffPeriod`, `YYYY-MM`, or null when the org keeps no books yet. */
  cutoffPeriod: string | null
  /** `ledger.lockedThroughMonth`, `YYYY-MM`, or null when nothing is closed. */
  lockedThroughMonth: string | null
  /**
   * `accounting.bookTimeZone`, or null when it is unset.
   *
   * 🛑 Null rather than a `'UTC'` default. 44 lane 4's rule: a run whose day
   * boundaries were cut in the wrong zone dates revenue to the wrong month
   * invisibly, so `run.ts` REFUSES rather than guessing.
   */
  timeZone: string | null
  ledgerCurrency: string
}

/**
 * The four ambient values a run is decided against, read once.
 *
 * `resolvePeriodLock` fails CLOSED on a malformed lock and that refusal is kept:
 * a bulk run is the last place to fall back to "nothing is closed".
 */
export async function readFulfillmentPostingSettings(
  db: Database | Transaction,
  organizationId: string
): Promise<Result<FulfillmentPostingSettings, Error>> {
  return guard(
    async () => {
      const [cutoffPeriod, timeZone, lock] = await Promise.all([
        readTextSetting(db, organizationId, OPENING_BASELINE_SETTING_KEYS.cutoffPeriod),
        readTextSetting(db, organizationId, OPENING_BASELINE_SETTING_KEYS.bookTimeZone),
        resolvePeriodLock(organizationId, db),
      ])
      return {
        cutoffPeriod,
        lockedThroughMonth: lock.lockedThroughMonth,
        timeZone,
        ledgerCurrency: LEDGER_CURRENCY,
      }
    },
    'Failed to read the fulfillment posting settings',
    { organizationId }
  )
}

/** One organization setting as a trimmed string, or null for unset or blank. */
export async function readTextSetting(
  db: Database | Transaction,
  organizationId: string,
  key: Parameters<typeof getOrganizationSetting>[0]['key']
): Promise<string | null> {
  const value = await getOrganizationSetting({ organizationId, key, db })
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** What is known about a line the fulfillment names but the line read could not reach. */
const UNKNOWN_LINE = {
  unitPriceMinor: 0,
  lineTaxMinor: null,
  orderedQuantity: 0,
  lineTotalMinor: null,
} satisfies Omit<UnpostedShipmentLine, 'lineId' | 'quantity' | 'priorShippedQuantity'>

/** One order's facts, as the shipments on it need them. */
interface OrderFacts {
  number: string
  channel: string | null
  currency: string | null
  financialStatus: string | null
  gateways: string[]
  subtotalMinor: number
  taxTotalMinor: number
  shippingTotalMinor: number
  contactId: string | null
}

/**
 * The order fields for every order the netting read touched, in ONE query.
 *
 * ⚠️ `order_payment_gateways` is a TAGS field: one `FieldValue` row per gateway,
 * each holding an opaque option KEY rather than the gateway's name. The name is
 * in the field's own option list, so every key is resolved through
 * `resolveOptionId`, which falls back to the raw stored value - which is exactly
 * right for a connector-provisioned option set, where the key IS the name.
 */
async function readOrderFacts(
  db: Database | Transaction,
  organizationId: string,
  ctx: OrderFieldContext,
  orderIds: string[]
): Promise<Map<string, OrderFacts>> {
  const facts = new Map<string, OrderFacts>()
  if (orderIds.length === 0) return facts

  const fieldIds = Object.values(ctx.order)
    .filter((field): field is NonNullable<typeof field> => field != null)
    .map((field) => field.id)
  const rows = await selectValues(db, organizationId, orderIds, fieldIds)

  const gatewayOptions = buildOptionIndex(
    ((ctx.order.order_payment_gateways?.options ?? {}) as FieldOptions).options ?? []
  )

  for (const orderId of orderIds) {
    const bucket = rows.get(orderId)
    // 🛑 An order with no readable field value at all is skipped, and
    // `readUnpostedShipments` then drops its shipments. Defaulting instead
    // would hand the builder a nameless order with a zero subtotal, which
    // posts an entry that balances and recognises the wrong number.
    if (!bucket) continue
    const cell = (attribute: keyof OrderFieldContext['order']) => {
      const field = ctx.order[attribute]
      return field ? bucket?.get(field.id)?.[0] : undefined
    }
    const cells = (attribute: keyof OrderFieldContext['order']) => {
      const field = ctx.order[attribute]
      return field ? (bucket?.get(field.id) ?? []) : []
    }

    facts.set(orderId, {
      number: cell('order_number')?.valueText ?? '',
      // A SINGLE_SELECT stores its value in `optionId`, and the registry
      // declares these two option sets, so the key IS the value.
      channel: cell('order_channel')?.optionId ?? null,
      currency: cell('order_currency')?.valueText ?? null,
      financialStatus: cell('order_financial_status')?.optionId ?? null,
      gateways: cells('order_payment_gateways').flatMap((row) => {
        const key = row.optionId ?? row.valueText
        if (!key) return []
        const resolved = resolveOptionId(key, gatewayOptions)
        return [resolved.status === 'known' ? resolved.label : resolved.raw]
      }),
      subtotalMinor: amount(cell('order_subtotal')?.valueNumber),
      taxTotalMinor: amount(cell('order_tax_total')?.valueNumber),
      shippingTotalMinor: amount(cell('order_shipping_total')?.valueNumber),
      contactId: cell('order_contact')?.relatedEntityId ?? null,
    })
  }
  return facts
}

/** The line fields for every line the shipments name, in ONE query. */
async function readLineFacts(
  db: Database | Transaction,
  organizationId: string,
  ctx: OrderFieldContext,
  lineIds: string[]
): Promise<
  Map<string, Omit<UnpostedShipmentLine, 'lineId' | 'quantity' | 'priorShippedQuantity'>>
> {
  const facts = new Map<
    string,
    Omit<UnpostedShipmentLine, 'lineId' | 'quantity' | 'priorShippedQuantity'>
  >()
  if (lineIds.length === 0) return facts

  const fieldIds = Object.values(ctx.line)
    .filter((field): field is NonNullable<typeof field> => field != null)
    .map((field) => field.id)
  const rows = await selectValues(db, organizationId, lineIds, fieldIds)

  for (const lineId of lineIds) {
    const bucket = rows.get(lineId)
    const cell = (attribute: keyof OrderFieldContext['line']) => {
      const field = ctx.line[attribute]
      return field ? bucket?.get(field.id)?.[0] : undefined
    }
    const taxTotal = cell('line_item_tax_total')?.valueNumber
    const netTotal = cell('line_item_net_total')?.valueNumber
    const lineTotal = cell('line_item_line_total')?.valueNumber
    const totals = {
      netTotalMinor: netTotal == null ? null : amount(netTotal),
      lineTotalMinor: lineTotal == null ? null : amount(lineTotal),
    }
    const orderedQuantity = cell('line_item_qty')?.valueNumber ?? 0
    facts.set(lineId, {
      // 🛑 The line NET per unit, never `line_item_unit_price` on its own: that
      // is the PRE-discount price, and `line_item_net_total` is what the
      // customer was actually charged for the line (29 §1.7, §2.3), with the
      // gross `line_item_line_total` as the fallback for a line that has no
      // net yet. An absent total of either kind falls back to the price; a
      // zero total is a fully discounted line and stays zero. A RATE, left
      // unrounded - `extendRateToAmount` in the builder is the one boundary
      // that turns a rate into an amount.
      unitPriceMinor: netUnitPriceMinor({
        ...totals,
        unitPriceMinor: cell('line_item_unit_price')?.valueNumber,
        orderedQuantity,
      }),
      // The whole line's NET travels too (the same column the rate came from),
      // so the builder can allocate it by units across a split line instead of
      // extending a fractional rate (29 §12 item 6).
      lineTotalMinor: netLineTotalMinor(totals),
      // 🛑 `?? null`, never `?? 0`: an absent row means the channel said
      // nothing about this line's tax, which is what makes the builder allocate
      // the order's total instead of trusting a zero (48 §8.2).
      lineTaxMinor: taxTotal == null ? null : amount(taxTotal),
      orderedQuantity,
      name: cell('line_item_name')?.valueText ?? undefined,
    })
  }
  return facts
}

/** One `FieldValue` row, in the columns this module reads. */
interface ValueRow {
  fieldId: string
  valueText: string | null
  valueNumber: number | null
  optionId: string | null
  relatedEntityId: string | null
}

/**
 * `FieldValue` rows for a set of instances and fields, bucketed
 * `instance -> field -> rows`.
 *
 * The inner value is an ARRAY because a multi-value field has one row per value
 * - `order_payment_gateways` is exactly that, and a `Map<fieldId, row>` would
 * silently keep only the last gateway, which is the input the debit fork's
 * ambiguity rule is decided from.
 */
async function selectValues(
  db: Database | Transaction,
  organizationId: string,
  entityIds: string[],
  fieldIds: string[]
): Promise<Map<string, Map<string, ValueRow[]>>> {
  const buckets = new Map<string, Map<string, ValueRow[]>>()
  if (entityIds.length === 0 || fieldIds.length === 0) return buckets

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      optionId: schema.FieldValue.optionId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
      sortKey: schema.FieldValue.sortKey,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, entityIds),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )
    .orderBy(schema.FieldValue.sortKey)

  for (const row of rows) {
    let byField = buckets.get(row.entityId)
    if (!byField) {
      byField = new Map()
      buckets.set(row.entityId, byField)
    }
    const list = byField.get(row.fieldId)
    if (list) list.push(row)
    else byField.set(row.fieldId, [row])
  }
  return buckets
}

/**
 * A stored money AMOUNT, as whole minor units.
 *
 * ⚠️ Rounded here rather than refused, which is where this differs from
 * `toAmountMinor` in `postings/build-fulfillment-entry.ts`. That function is
 * right for ONE order a person is fulfilling: a fractional cent is a bug
 * upstream and refusing names it. In a bulk run over hundreds of orders the
 * same refusal would take the whole batch down for one bad row, and every
 * amount here comes out of a `doublePrecision` column where `26400` reads back
 * as `26399.999999999996` anyway. `plan.ts` stays total as a result.
 */
function amount(value: number | null | undefined): number {
  return value == null || !Number.isFinite(value) ? 0 : Math.round(value)
}
