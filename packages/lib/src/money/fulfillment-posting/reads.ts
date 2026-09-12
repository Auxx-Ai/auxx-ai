// packages/lib/src/money/fulfillment-posting/reads.ts

/**
 * The netting read behind the bulk fulfillment poster: every shipment in a
 * range that carries no LIVE posting.
 *
 * `plans/money/tasks/49-bulk-fulfillment-posting.md` §2.2, §2.5 and §8.2.
 * `plans/money/tasks/55-shipment-lines.md` §6 (entity migration 153).
 *
 * Reads only, no permission checks - the router asserts and hands the range
 * down (`docs/lib-module-guide.md` §5 and §6). The pure decision over what this
 * returns is `plan.ts`; the writes are `run.ts`.
 *
 * ## 🛑 "Unposted" is the ABSENCE OF A LIVE POSTING, not a null stamp
 *
 * §2.6 rule 1 and decision 9: reversing a day's entry has to put its shipments
 * back into the next preview, and the run un-stamps nothing. So a shipment is
 * unposted when its `fulfillment_gl_posting` is null, OR names a posting whose
 * status is `reversed`, OR names a posting that no longer exists at all.
 * Reading only the null case would strand every shipment of a reversed run: the
 * ledger would hold no entry for them and the netting read would never offer
 * them again.
 *
 * ## 🔑 Entity migration 153: the shipment log is real records now
 *
 * A shipment used to be one entry inside the `order_fulfillments` JSON array,
 * expanded with `jsonb_array_elements` and windowed for
 * `priorShipmentsSubtotalMinor` in one statement. `order_fulfillments` is a
 * has_many RELATIONSHIP to real `fulfillment` / `fulfillment_line` records now
 * (`plans/money/tasks/55-shipment-lines.md`), and the has_many (inverse) side
 * of a relationship carries no `FieldValue` row of its own to expand - there is
 * nothing left to `jsonb_array_elements` over.
 *
 * `money/fulfillments` is the shared contract for reading a `fulfillment`
 * record, but it exposes only "every fulfillment of these orders"
 * ({@link readFulfillmentsForOrders}) - there is no bulk "every unposted
 * fulfillment in a date range across the whole org" reader, because nothing
 * else needed one before this file did. 🛑 **That is a gap in the contract,
 * not a shortcut taken here**: discovering the CANDIDATE set for a range still
 * has to query `fulfillment_shipped_at` / `fulfillment_gl_posting`
 * `FieldValue` rows directly ({@link readUnpostedFulfillmentCandidates}), the
 * same way `credit-memo-posting/reads.ts` queries `credit_memo`'s own fields
 * directly for the identical reason - a poster is the one place that legitimately
 * owns ITS entity's netting query, the way `money/fulfillments` owns assembling
 * a full record. Once the candidate ids (and the orders they belong to) are
 * known, every further read goes through the shared bulk reader.
 *
 * ## One netting query, then BOUNDED reads for the rest
 *
 * The backlog this exists for is hundreds of orders (§5), so a read per order
 * is the shape batching exists to escape - the same rule
 * `builds/backfill-queries.ts` states. So: one statement finds the candidate
 * `(fulfillmentId, orderId)` pairs in the range; {@link readFulfillmentsForOrders}
 * then reads EVERY fulfillment of those orders (live or not, in range or not)
 * in four more queries regardless of how many orders that is; and two more
 * pivot the order and line-item fields for whatever came back.
 *
 * `priorShipmentsSubtotalMinor` is computed from that same bulk read, as a
 * running sum in sequence order over EVERY fulfillment of the order - not just
 * the candidates - because it is what makes the builder's cumulative tax
 * allocation true itself up on the shipment that completes an order, and an
 * earlier shipment is usually already posted and therefore not itself a
 * candidate.
 */

import { type Database, schema } from '@auxx/database'
import { and, asc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import type { FieldOptions } from '../../field-values/converters'
import { resolvePeriodLock } from '../../postings/period-lock'
import { LEDGER_CURRENCY } from '../../postings/post-entry'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import { buildOptionIndex, resolveOptionId } from '../../resources/registry/option-helpers'
import { getOrganizationSetting } from '../../settings/settings-service'
import {
  type Fulfillment,
  type FulfillmentFieldContext,
  isLiveFulfillment,
  loadFulfillmentFieldContext,
  readFulfillmentsForOrder,
  readFulfillmentsForOrders,
} from '../fulfillments'
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

/**
 * A calendar day as the instant a `DATETIME` cell is compared against.
 *
 * 🛑 Midnight UTC, and the comparison is deliberately on the RAW instant rather
 * than on a re-zoned day - `credit-memo-posting/reads.ts`'s `dayStart` states
 * the same rule for the same reason: everything here reads an accounting date
 * by SLICING the first ten characters of the stored ISO string
 * ({@link toCalendarDay}), and `instant >= ${from}T00:00:00Z` selects exactly
 * the rows whose slice is `>= from`.
 */
function dayStart(day: string): string {
  return `${day}T00:00:00.000Z`
}

/** `fulfillment_shipped_at` is an ISO instant; the accounting date is its day. */
function toCalendarDay(raw: string | null | undefined): string | null {
  return typeof raw === 'string' && raw.length >= 10 ? raw.slice(0, 10) : null
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** One `fulfillment` in the range that no live posting claims, and the order it belongs to. */
interface FulfillmentCandidate {
  fulfillmentId: string
  orderId: string
}

/**
 * THE netting statement: the `(fulfillment, order)` pairs in the range with no
 * LIVE posting.
 *
 * 🛑 The three predicates in the final `or` are the whole netting contract
 * (49 §2.6 rule 1) - a null stamp, a stamp naming a posting that is gone, or one
 * naming a `reversed` posting. Dropping any of them would silently strand a
 * reversed period's shipments: they would simply never be offered again.
 *
 * ⚠️ An org with no `fulfillment_gl_posting` field (entity migration 153 has
 * not reached it - unreachable in practice, since {@link loadFulfillmentFieldContext}
 * already refused before this runs) would join on a field id no row can carry,
 * so every candidate in range reads as unposted, which is the truth for such an
 * org (nothing has ever been stamped).
 */
async function readUnpostedFulfillmentCandidates(
  db: Database,
  organizationId: string,
  ctx: FulfillmentFieldContext,
  range: UnpostedShipmentRange
): Promise<FulfillmentCandidate[]> {
  const shippedAtField = ctx.fulfillment.fulfillment_shipped_at
  const orderField = ctx.fulfillment.fulfillment_order
  if (!shippedAtField || !orderField) return []
  const glPostingFieldId = ctx.fulfillment.fulfillment_gl_posting?.id ?? ''

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
      schema.GlPosting,
      and(
        eq(schema.GlPosting.id, stamp.valueText),
        eq(schema.GlPosting.organizationId, organizationId)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, shippedAtField.id),
        gte(schema.FieldValue.valueDate, dayStart(range.from)),
        lt(schema.FieldValue.valueDate, dayStart(range.to)),
        or(
          isNull(stamp.valueText),
          isNull(schema.GlPosting.id),
          eq(schema.GlPosting.status, 'reversed')
        )
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
 * Every shipment in the range that no live posting claims, with everything the
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
  db: Database,
  params: { organizationId: string; range: UnpostedShipmentRange }
): Promise<Result<UnpostedShipment[], Error>> {
  const { organizationId, range } = params

  return guard(
    async () => {
      assertIsoDate(range.from, 'The range start')
      assertIsoDate(range.to, 'The range end')

      const fulfillmentCtx = await loadFulfillmentFieldContext(organizationId)
      if (!fulfillmentCtx) return []

      const candidates = await readUnpostedFulfillmentCandidates(
        db,
        organizationId,
        fulfillmentCtx,
        range
      )
      if (candidates.length === 0) return []

      const candidateIds = new Set(candidates.map((row) => row.fulfillmentId))
      const orderIds = [...new Set(candidates.map((row) => row.orderId))]

      const [ctx, byOrder] = await Promise.all([
        requireOrderFieldContext(organizationId),
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

      const [orders, lines, taxLinesByOrder] = await Promise.all([
        readOrderFacts(db, organizationId, ctx, orderIds),
        readLineFacts(db, organizationId, ctx, [...lineIds]),
        // ONE bulk read for the whole batch, never per order (brief 13 §5).
        readOrderTaxLines(db, organizationId, orderIds),
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
              lines,
              taxLinesByOrder.get(orderId) ?? []
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
          }
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
  lineFacts: Map<string, Omit<UnpostedShipmentLine, 'lineId' | 'quantity'>>,
  taxLines: readonly { title: string; priceMinor: number }[]
): UnpostedShipment | null {
  const shippedAt = toCalendarDay(fulfillment.shippedAt)
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
    lines: fulfillment.lines.map((line) => ({
      lineId: line.lineItemId,
      quantity: line.quantity,
      ...(lineFacts.get(line.lineItemId) ?? UNKNOWN_LINE),
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
  db: Database,
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
  db: Database,
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
  _db: Database,
  organizationId: string
): Promise<Result<FulfillmentPostingSettings, Error>> {
  // `_db` is unused: every value here is an organization SETTING, and
  // `settings-service` owns its own connection. It stays in the signature so
  // every export of this module reads `db` first (`docs/lib-module-guide.md`
  // §4) and so a future read that does need the connection is not a signature
  // change for every caller.
  return guard(
    async () => {
      const [cutoffPeriod, timeZone, lock] = await Promise.all([
        readTextSetting(organizationId, OPENING_BASELINE_SETTING_KEYS.cutoffPeriod),
        readTextSetting(organizationId, OPENING_BASELINE_SETTING_KEYS.bookTimeZone),
        resolvePeriodLock(organizationId),
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
async function readTextSetting(
  organizationId: string,
  key: Parameters<typeof getOrganizationSetting>[0]['key']
): Promise<string | null> {
  const value = await getOrganizationSetting({ organizationId, key })
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** What is known about a line the fulfillment names but the line read could not reach. */
const UNKNOWN_LINE = {
  unitPriceMinor: 0,
  lineTaxMinor: null,
  orderedQuantity: 0,
} satisfies Omit<UnpostedShipmentLine, 'lineId' | 'quantity'>

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
  db: Database,
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
  db: Database,
  organizationId: string,
  ctx: OrderFieldContext,
  lineIds: string[]
): Promise<Map<string, Omit<UnpostedShipmentLine, 'lineId' | 'quantity'>>> {
  const facts = new Map<string, Omit<UnpostedShipmentLine, 'lineId' | 'quantity'>>()
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
    facts.set(lineId, {
      // 🛑 A RATE, left unrounded. `extendRateToAmount` in the builder is the
      // one boundary that turns a rate into an amount.
      unitPriceMinor: cell('line_item_unit_price')?.valueNumber ?? 0,
      // 🛑 `?? null`, never `?? 0`: an absent row means the channel said
      // nothing about this line's tax, which is what makes the builder allocate
      // the order's total instead of trusting a zero (48 §8.2).
      lineTaxMinor: taxTotal == null ? null : amount(taxTotal),
      orderedQuantity: cell('line_item_qty')?.valueNumber ?? 0,
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
  db: Database,
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
