// packages/lib/src/money/fulfillment-posting/reads.ts

/**
 * The netting read behind the bulk fulfillment poster: every shipment in a
 * range that carries no LIVE posting.
 *
 * `plans/money/tasks/49-bulk-fulfillment-posting.md` §2.2, §2.5 and §8.2.
 *
 * Reads only, no permission checks - the router asserts and hands the range
 * down (`docs/lib-module-guide.md` §5 and §6). The pure decision over what this
 * returns is `plan.ts`; the writes are `run.ts`.
 *
 * ## 🛑 "Unposted" is the ABSENCE OF A LIVE POSTING, not a null stamp
 *
 * §2.6 rule 1 and decision 9: reversing a day's entry has to put its shipments
 * back into the next preview, and the run un-stamps nothing. So a shipment is
 * unposted when its `glPostingId` is null, OR names a posting whose status is
 * `reversed`, OR names a posting that no longer exists at all. Reading only the
 * null case would strand every shipment of a reversed run: the ledger would
 * hold no entry for them and the netting read would never offer them again.
 *
 * ## 🛑 One SQL for the log, then BOUNDED reads for the fields
 *
 * The backlog this exists for is 531 orders over three months (§5), so a read
 * per order is the shape batching exists to escape - the same rule
 * `builds/backfill-queries.ts` states. The shipment log lives inside ONE JSON
 * cell per order, so it is expanded with `jsonb_array_elements` in the database
 * and joined to `GlPosting` there; then exactly two more queries pivot the order
 * and line fields for whatever came back, regardless of how many orders that is.
 *
 * `priorShipmentsSubtotalMinor` is computed in the same statement, as a window
 * over EVERY earlier sequence of the same log - live or not. It is what makes
 * the builder's cumulative tax allocation true itself up on the shipment that
 * completes an order, and it cannot be derived from the returned rows, because
 * the earlier shipments are usually already posted and therefore filtered out.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import type { FieldOptions } from '../../field-values/converters'
import { resolvePeriodLock } from '../../postings/period-lock'
import { LEDGER_CURRENCY } from '../../postings/post-entry'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import { buildOptionIndex, resolveOptionId } from '../../resources/registry/option-helpers'
import { getOrganizationSetting } from '../../settings/settings-service'
import {
  type OrderFieldContext,
  parseFulfillments,
  requireOrderFieldContext,
} from '../orders/reads'
import { guard } from './guard'
import { planFulfillmentPosting } from './plan'
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
 * One log entry the netting SQL kept, before any order or line field is read.
 *
 * Every column is text or a float because it came out of `jsonb`; the numbers
 * are re-coerced in TypeScript rather than trusted from the driver.
 */
interface UnpostedEntryRow {
  order_id: string
  sequence: number | string
  shipped_at: string
  prior_subtotal_minor: number | string | null
  shipping_recognised: boolean | null
  lines: unknown
}

/**
 * THE netting statement.
 *
 * Written once and used by both {@link readUnpostedShipments} and
 * {@link countUnpostedShipments}, because a count that could disagree with the
 * list it counts is exactly the defect a close refusal must not have (lane D
 * reads the count to refuse `prepareClose`).
 *
 * ⚠️ Two spellings of the stored cell are tolerated on the way in -
 * `{ v: { fulfillments } }` and a bare `{ fulfillments }` - because
 * `parseFulfillments` is tolerant of both and a read that was stricter than the
 * parser would report shipments the rest of the module cannot see.
 */
function unpostedEntriesQuery(
  organizationId: string,
  fulfillmentsFieldId: string,
  range: UnpostedShipmentRange
) {
  const entries = sql`coalesce(
    ${schema.FieldValue.valueJson} -> 'v' -> 'fulfillments',
    ${schema.FieldValue.valueJson} -> 'fulfillments'
  )`

  return sql`
    WITH log AS (
      SELECT ${schema.FieldValue.entityId} AS order_id, ${entries} AS entries
      FROM ${schema.FieldValue}
      WHERE ${schema.FieldValue.organizationId} = ${organizationId}
        AND ${schema.FieldValue.fieldId} = ${fulfillmentsFieldId}
        AND jsonb_typeof(${entries}) = 'array'
    ),
    expanded AS (
      SELECT
        log.order_id,
        e.entry,
        -- 🛑 CASE, not a bare cast guarded by the WHERE. Postgres does not
        -- promise to evaluate a WHERE before the target list of the same query
        -- level, and a CTE may be inlined, so a log row carrying
        -- "sequence": "first" would abort the whole run with a cast error
        -- rather than being skipped. Every cast below is guarded in place.
        CASE
          WHEN jsonb_typeof(e.entry) = 'object' AND (e.entry ->> 'sequence') ~ '^[0-9]+$'
          THEN (e.entry ->> 'sequence')::int
        END AS sequence,
        coalesce(e.entry ->> 'shippedAt', '') AS shipped_at,
        e.entry ->> 'glPostingId' AS gl_posting_id,
        CASE
          WHEN (e.entry ->> 'subtotalMinor') ~ '^-?[0-9]+([.][0-9]+)?$'
          THEN (e.entry ->> 'subtotalMinor')::float8
          ELSE 0
        END AS subtotal_minor
      FROM log
      CROSS JOIN LATERAL jsonb_array_elements(log.entries) AS e(entry)
    ),
    ranked AS (
      SELECT
        expanded.*,
        coalesce(
          sum(expanded.subtotal_minor) OVER (
            PARTITION BY expanded.order_id
            ORDER BY expanded.sequence
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ),
          0
        ) AS prior_subtotal_minor
      FROM expanded
      WHERE expanded.sequence IS NOT NULL
    )
    SELECT
      ranked.order_id,
      ranked.sequence,
      ranked.shipped_at,
      ranked.prior_subtotal_minor,
      coalesce(ranked.entry ->> 'shippingRecognised', 'false') = 'true' AS shipping_recognised,
      ranked.entry -> 'lines' AS lines
    FROM ranked
    LEFT JOIN ${schema.GlPosting} ON ${schema.GlPosting.id} = ranked.gl_posting_id
      AND ${schema.GlPosting.organizationId} = ${organizationId}
    WHERE ranked.shipped_at >= ${range.from}
      AND ranked.shipped_at < ${range.to}
      AND (
        ranked.gl_posting_id IS NULL
        OR ${schema.GlPosting.id} IS NULL
        OR ${schema.GlPosting.status} = 'reversed'
      )
    ORDER BY ranked.shipped_at, ranked.order_id, ranked.sequence
  `
}

/**
 * Every shipment in the range that no live posting claims, with everything the
 * builder needs riding on it.
 *
 * An org with no provisioned `order` def reads as no shipments rather than as
 * an error: there is nothing to post, and a preview showing an empty plan is
 * the honest answer. The one refusal is a malformed period lock, which
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

      const ctx = await requireOrderFieldContext(organizationId)
      const fulfillmentsFieldId = ctx.order.order_fulfillments?.id
      if (!fulfillmentsFieldId) return []

      const result = await db.execute(
        unpostedEntriesQuery(organizationId, fulfillmentsFieldId, range)
      )
      const rows = (result.rows ?? []) as unknown as UnpostedEntryRow[]
      if (rows.length === 0) return []

      const orderIds = [...new Set(rows.map((row) => row.order_id))]
      const logLines = rows.map((row) => parseLogLines(row.lines))
      const lineIds = [...new Set(logLines.flatMap((lines) => lines.map((line) => line.lineId)))]

      const [orders, lines] = await Promise.all([
        readOrderFacts(db, organizationId, ctx, orderIds),
        readLineFacts(db, organizationId, ctx, lineIds),
      ])

      const shipments: UnpostedShipment[] = []
      for (const [index, row] of rows.entries()) {
        const order = orders.get(row.order_id)
        // An order whose fields cannot be read at all is dropped rather than
        // posted from defaults: an entry built on a guessed subtotal balances
        // and is wrong, and nothing downstream could see it.
        if (!order) continue
        shipments.push({
          orderId: row.order_id,
          orderNumber: order.number,
          sequence: Number(row.sequence),
          shippedAt: row.shipped_at,
          lines: (logLines[index] ?? []).map((line) => ({
            lineId: line.lineId,
            quantity: line.quantity,
            ...(lines.get(line.lineId) ?? UNKNOWN_LINE),
          })),
          channel: order.channel,
          currency: order.currency,
          financialStatus: order.financialStatus,
          gateways: order.gateways,
          orderSubtotalMinor: order.subtotalMinor,
          orderTaxTotalMinor: order.taxTotalMinor,
          orderShippingTotalMinor: order.shippingTotalMinor,
          priorShipmentsSubtotalMinor: finite(row.prior_subtotal_minor),
          includeShipping: row.shipping_recognised === true,
          contactId: order.contactId,
        })
      }
      return shipments
    },
    'Failed to read unposted shipments',
    { organizationId, from: range.from, to: range.to }
  )
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
      const settings = await readFulfillmentPostingSettings(db, organizationId)
      if (settings.isErr()) throw settings.error
      const plan = planFulfillmentPosting({
        shipments: shipments.value,
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
 * The postings one order's shipment log names, with each posting's CURRENT
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
      const ctx = await requireOrderFieldContext(organizationId)
      const fulfillmentsFieldId = ctx.order.order_fulfillments?.id
      if (!fulfillmentsFieldId) return []

      const [row] = await db
        .select({ valueJson: schema.FieldValue.valueJson })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.entityId, orderId),
            eq(schema.FieldValue.fieldId, fulfillmentsFieldId)
          )
        )
        .limit(1)

      const stamps = parseFulfillments(row?.valueJson)
        .filter((entry) => entry.glPostingId !== null)
        .map((entry) => ({
          sequence: entry.sequence,
          shippedAt: entry.shippedAt,
          glPostingId: entry.glPostingId as string,
        }))
      if (stamps.length === 0) return []

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
              stamps.map((stamp) => stamp.glPostingId)
            )
          )
        )
      const byId = new Map(postings.map((posting) => [posting.id, posting]))

      const refs: OrderFulfillmentPostingRef[] = []
      for (const stamp of stamps) {
        const posting = byId.get(stamp.glPostingId)
        if (!posting) continue
        refs.push({
          sequence: stamp.sequence,
          shippedAt: stamp.shippedAt,
          glPostingId: stamp.glPostingId,
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

/** What is known about a line the log names but the line read could not reach. */
const UNKNOWN_LINE = {
  unitPriceMinor: 0,
  lineTaxMinor: null,
  orderedQuantity: 0,
} satisfies Omit<UnpostedShipmentLine, 'lineId' | 'quantity'>

/** The log's own `{ lineId, quantity }` rows, read as tolerantly as the parser. */
function parseLogLines(value: unknown): Array<{ lineId: string; quantity: number }> {
  if (!Array.isArray(value)) return []
  const lines: Array<{ lineId: string; quantity: number }> = []
  for (const row of value) {
    if (typeof row !== 'object' || row === null) continue
    const { lineId, quantity } = row as { lineId?: unknown; quantity?: unknown }
    if (typeof lineId !== 'string' || typeof quantity !== 'number') continue
    if (!Number.isFinite(quantity) || quantity <= 0) continue
    lines.push({ lineId, quantity })
  }
  return lines
}

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

/** A number the driver may have handed back as text. */
function finite(value: number | string | null | undefined): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  return parsed != null && Number.isFinite(parsed) ? parsed : 0
}
