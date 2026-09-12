// packages/lib/src/money/credit-memo-posting/reads.ts

/**
 * The netting read behind the bulk credit memo poster: every memo in a range
 * that carries no LIVE posting.
 *
 * `plans/accounting/tasks/25-batch-posting-and-credit-memos.md` §4 and §9.1.
 *
 * Reads only, no permission checks - the router asserts and hands the range
 * down (`docs/lib-module-guide.md` §5 and §6). The pure decision over what this
 * returns is `plan.ts`; the writes are `run.ts`.
 *
 * ## 🛑 "Unposted" is the ABSENCE OF A LIVE POSTING, not a null stamp
 *
 * §4.2, verbatim from 49 §2.6 rule 1, and it is not optional: a memo is unposted
 * when its `credit_memo_gl_posting` is null, OR names a posting whose status is
 * `reversed`, OR names a posting that no longer exists. Reading only the null
 * case strands every memo of a reversed run - the ledger holds no entry for
 * them, and the netting read would never offer them again. §2.1 makes
 * reverse-and-repost the ONLY correction path for a batched memo, so this
 * predicate is the whole of that path.
 *
 * ## 🛑 One statement for the netting, then BOUNDED reads for the fields
 *
 * The backlog this exists for is 1,061 memos (§4.3), so a read per memo is the
 * shape batching exists to escape - the same rule `builds/backfill-queries.ts`
 * states and `fulfillment-posting/reads.ts` follows. `credit_memo` is
 * `EntityInstance`-backed, so the netting is a `FieldValue` pivot joined to
 * `GlPosting` through the declared stamp (§4.1 chose a declared TEXT field over
 * a JSON slice for exactly this reason), and then a FIXED number of further
 * queries pivot the memo and order fields for whatever came back, regardless of
 * how many memos that is:
 *
 * | # | query | grain |
 * |---|---|---|
 * | 1 | the netting join | one row per unposted memo |
 * | 2 | the memo field pivot | every memo the netting kept |
 * | 3 | the order field pivot (`order_currency`, `order_fulfillments`) | every order those memos name |
 *
 * ⚠️ Two per-memo reads the single-memo door makes are deliberately NOT made
 * here. `orderHadFulfillmentBefore` (which decides `reverseRevenue`) is answered
 * set-based out of query 3, and `resolveSettlementAccount`'s gateway read is
 * answered set-based by {@link readCreditMemoSettlementAccounts}. Either one in
 * a loop is a thousand round trips per preview.
 */

import { type Database, schema } from '@auxx/database'
import { and, asc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { listPaymentGateways, toGatewayRoutes } from '../../payment-gateways'
import { matchGatewayRoute } from '../../payment-gateways/client'
import { resolvePeriodLock } from '../../postings/period-lock'
import { LEDGER_CURRENCY } from '../../postings/post-entry'
import { OPENING_BASELINE_SETTING_KEYS } from '../../postings/setup-readiness'
import { getOrganizationSetting } from '../../settings/settings-service'
import { parseFulfillments } from '../orders/reads'
import { guard } from './guard'
import { planCreditMemoPosting } from './plan'
import type {
  CreditMemoPostingExclusionReason,
  CreditMemoPostingPlan,
  CreditMemoPostingRef,
  UnpostedCreditMemo,
} from './types'
import { CREDIT_MEMO_GL_POSTING_ATTRIBUTE } from './types'

/** Half-open on `issuedAt`: `from <= issuedAt < to`, both `YYYY-MM-DD`. */
export interface UnpostedCreditMemoRange {
  from: string
  to: string
}

/** Every `credit_memo` attribute the netting read pivots. */
const CREDIT_MEMO_ATTRIBUTES = [
  'credit_memo_number',
  'credit_memo_status',
  'credit_memo_source',
  'credit_memo_issued_at',
  'credit_memo_contact',
  'credit_memo_order',
  'credit_memo_subtotal',
  'credit_memo_tax_total',
  'credit_memo_total',
  'credit_memo_amount_refunded',
  CREDIT_MEMO_GL_POSTING_ATTRIBUTE,
] as const

/** Every `order` attribute a memo borrows. */
const ORDER_ATTRIBUTES = ['order_currency', 'order_fulfillments'] as const

type CreditMemoAttribute = (typeof CREDIT_MEMO_ATTRIBUTES)[number]
type OrderAttribute = (typeof ORDER_ATTRIBUTES)[number]
type FieldMap<A extends string> = Record<A, { id: string } | null>

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
function monthRange(month: string): UnpostedCreditMemoRange {
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
 * than on a re-zoned day. Everything in the credit memo modules reads an
 * accounting date by SLICING the first ten characters of the stored ISO string
 * (`credit-memos/reads.ts`'s `toCalendarDay`, `countUnissuedChannelCreditMemos`),
 * and `instant >= ${from}T00:00:00Z` selects exactly the rows whose slice is
 * `>= from`. Deriving a book-zone day here and slicing there would let the
 * preview offer a memo the poster then dates into a different month.
 */
function dayStart(day: string): string {
  return `${day}T00:00:00.000Z`
}

/** `FieldValue.valueDate` is an ISO instant; the accounting date is its day. */
function toCalendarDay(raw: string | null | undefined): string | null {
  return typeof raw === 'string' && raw.length >= 10 ? raw.slice(0, 10) : null
}

/** One `FieldValue` row, in the columns this module reads. */
interface ValueRow {
  fieldId: string
  valueText: string | null
  valueNumber: number | null
  valueDate: string | null
  valueJson: unknown
  optionId: string | null
  relatedEntityId: string | null
}

/**
 * `FieldValue` rows for a set of instances and fields, bucketed
 * `instance -> field -> rows`.
 *
 * The inner value is an ARRAY because a multi-value field has one row per value
 * - `order_payment_gateways` is exactly that, and a `Map<fieldId, row>` would
 * silently keep only the last gateway, which is the input the settlement
 * fallback is decided from.
 */
async function selectValues(
  db: Database,
  organizationId: string,
  entityIds: readonly string[],
  fieldIds: readonly string[]
): Promise<Map<string, Map<string, ValueRow[]>>> {
  const buckets = new Map<string, Map<string, ValueRow[]>>()
  if (entityIds.length === 0 || fieldIds.length === 0) return buckets

  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      valueDate: schema.FieldValue.valueDate,
      valueJson: schema.FieldValue.valueJson,
      optionId: schema.FieldValue.optionId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, [...entityIds]),
        inArray(schema.FieldValue.fieldId, [...fieldIds])
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

/** The field ids of a resolved attribute map, dropping the ones the org lacks. */
function fieldIdsOf<A extends string>(fields: FieldMap<A>): string[] {
  return Object.values<{ id: string } | null>(fields)
    .filter((field): field is { id: string } => field != null)
    .map((field) => field.id)
}

/** A cell reader bound to one instance's bucket and one attribute map. */
function cellReader<A extends string>(
  fields: FieldMap<A>,
  bucket: Map<string, ValueRow[]> | undefined
): { cell: (attribute: A) => ValueRow | undefined; cells: (attribute: A) => ValueRow[] } {
  return {
    cell: (attribute) => {
      const field = fields[attribute]
      return field ? bucket?.get(field.id)?.[0] : undefined
    },
    cells: (attribute) => {
      const field = fields[attribute]
      return field ? (bucket?.get(field.id) ?? []) : []
    },
  }
}

/** Resolve one attribute set against the org's own `CustomField` rows. */
async function resolveFields<A extends string>(
  organizationId: string,
  attributes: readonly A[]
): Promise<FieldMap<A>> {
  return (await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...attributes])) as FieldMap<A>
}

/**
 * A stored money AMOUNT, as whole minor units.
 *
 * ⚠️ Rounded here rather than refused, which is where this differs from
 * `toAmountMinor` in `postings/build-fulfillment-entry.ts`. Every amount comes
 * out of a `doublePrecision` column where `26400` reads back as
 * `26399.999999999996`; the genuine refusals (a total that does not sum, a
 * refund larger than the credit) are `computeCreditMemoAmounts`'s, and reach the
 * plan as a `zero-value` exclusion rather than taking down the run.
 */
function amount(value: number | null | undefined): number {
  return value == null || !Number.isFinite(value) ? 0 : Math.round(value)
}

/**
 * Every memo in the range that no live posting claims, with everything the
 * planner and the builder need riding on it.
 *
 * An org that has not seeded the `credit_memo` def, or has not run entity
 * migration 152 and so has no stamp field yet, reads as honestly as it can:
 * no def means no memos, and no stamp field means every memo is unposted, which
 * is the truth (nothing has ever been stamped).
 *
 * @param range half-open on `issuedAt`, both `YYYY-MM-DD` in the book zone.
 */
export async function readUnpostedCreditMemos(
  db: Database,
  params: { organizationId: string; range: UnpostedCreditMemoRange }
): Promise<Result<UnpostedCreditMemo[], Error>> {
  const { organizationId, range } = params

  return guard(
    async () => {
      assertIsoDate(range.from, 'The range start')
      assertIsoDate(range.to, 'The range end')

      const fields = await resolveFields(organizationId, CREDIT_MEMO_ATTRIBUTES)
      const issuedAtField = fields.credit_memo_issued_at
      const statusField = fields.credit_memo_status
      if (!issuedAtField || !statusField) return []

      const ids = await readUnpostedIds(db, organizationId, fields, range)
      if (ids.length === 0) return []

      const buckets = await selectValues(db, organizationId, ids, fieldIdsOf(fields))

      // The orders the memos name, read ONCE for all of them: the currency they
      // are denominated in and the shipment log `reverseRevenue` is decided from.
      const orderIds = new Set<string>()
      for (const id of ids) {
        const { cell } = cellReader(fields, buckets.get(id))
        const orderId = cell('credit_memo_order')?.relatedEntityId
        if (orderId) orderIds.add(orderId)
      }
      const orders = await readOrderFacts(db, organizationId, [...orderIds])

      const memos: UnpostedCreditMemo[] = []
      for (const id of ids) {
        const { cell } = cellReader(fields, buckets.get(id))
        const issuedAt = toCalendarDay(cell('credit_memo_issued_at')?.valueDate)
        // Unreachable: the netting join is anchored on this very cell. Dropped
        // rather than defaulted, because a memo with no date has no period to
        // post into and guessing one recognises a return in the wrong month.
        if (!issuedAt) continue
        const status = cell('credit_memo_status')?.optionId
        if (!status) continue

        const source = cell('credit_memo_source')?.optionId ?? 'native'
        const orderId = cell('credit_memo_order')?.relatedEntityId ?? null
        const order = orderId ? orders.get(orderId) : undefined

        memos.push({
          creditMemoId: id,
          number: cell('credit_memo_number')?.valueText ?? '',
          issuedAt,
          status,
          source,
          // `credit_memo` carries no currency field of its own, so the order's
          // is the memo's; a native memo has no order and reads as the ledger
          // currency, which is what the single-memo door's
          // `organizationCurrency` fallback does with a blank setting.
          currency: order?.currency ?? null,
          subtotalMinor: amount(cell('credit_memo_subtotal')?.valueNumber),
          taxTotalMinor: amount(cell('credit_memo_tax_total')?.valueNumber),
          totalMinor: amount(cell('credit_memo_total')?.valueNumber),
          amountRefundedMinor: amount(cell('credit_memo_amount_refunded')?.valueNumber),
          contactId: cell('credit_memo_contact')?.relatedEntityId ?? null,
          orderId,
          reverseRevenue: resolveReverseRevenue(source, order, issuedAt),
        })
      }
      return memos
    },
    'Failed to read unposted credit memos',
    { organizationId, from: range.from, to: range.to }
  )
}

/**
 * THE netting statement: the ids of every memo in the range with no LIVE
 * posting.
 *
 * 🛑 The three predicates in the final `or` are the whole netting contract
 * (§4.2) - a null stamp, a stamp naming a posting that is gone, or one naming a
 * `reversed` posting. A refactor that dropped any of them would silently strand
 * a reversed period's memos, and nothing downstream would notice: they would
 * simply never be offered again.
 *
 * ⚠️ An org with no stamp field (entity migration 152 has not reached it) joins
 * on a field id no row can carry, so `stamp.valueText` is null for every memo
 * and all of them read as unposted. That is the truth for such an org, and it
 * keeps this a single query rather than two code paths.
 */
async function readUnpostedIds(
  db: Database,
  organizationId: string,
  fields: FieldMap<CreditMemoAttribute>,
  range: UnpostedCreditMemoRange
): Promise<string[]> {
  const issuedAtField = fields.credit_memo_issued_at
  if (!issuedAtField) return []
  const stampFieldId = fields[CREDIT_MEMO_GL_POSTING_ATTRIBUTE]?.id ?? ''

  const stamp = alias(schema.FieldValue, 'cm_gl_posting')

  const rows = await db
    .select({ creditMemoId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.FieldValue.entityId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .leftJoin(
      stamp,
      and(
        eq(stamp.organizationId, schema.FieldValue.organizationId),
        eq(stamp.entityId, schema.FieldValue.entityId),
        eq(stamp.fieldId, stampFieldId)
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
        eq(schema.FieldValue.fieldId, issuedAtField.id),
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

  return [...new Set(rows.map((row) => row.creditMemoId))]
}

/** One order's facts, as the memos against it need them. */
interface OrderFacts {
  currency: string | null
  /** The EARLIEST shipped calendar day in the log, or null when nothing shipped. */
  firstShippedAt: string | null
}

/**
 * The order fields for every order the netting read touched, in ONE query.
 *
 * 🛑 This is `orderHadFulfillmentBefore` made set-based. That function reads one
 * order's `order_fulfillments` cell per call, which is right for the single-memo
 * door and is 1,061 round trips here. `some(shippedDay <= issuedAt)` over a log
 * is `min(shippedDay) <= issuedAt`, so the whole log collapses to one date per
 * order and the comparison moves into {@link resolveReverseRevenue}. The
 * tolerant `parseFulfillments` is shared, so the two readings of the log cannot
 * disagree about what an entry is.
 */
async function readOrderFacts(
  db: Database,
  organizationId: string,
  orderIds: string[]
): Promise<Map<string, OrderFacts>> {
  const facts = new Map<string, OrderFacts>()
  if (orderIds.length === 0) return facts

  const fields = await resolveFields(organizationId, ORDER_ATTRIBUTES)
  const buckets = await selectValues(db, organizationId, orderIds, fieldIdsOf(fields))

  for (const orderId of orderIds) {
    const { cell } = cellReader<OrderAttribute>(fields, buckets.get(orderId))
    let firstShippedAt: string | null = null
    for (const entry of parseFulfillments(cell('order_fulfillments')?.valueJson)) {
      const shippedDay = toCalendarDay(entry.shippedAt)
      if (shippedDay && (firstShippedAt === null || shippedDay < firstShippedAt)) {
        firstShippedAt = shippedDay
      }
    }
    facts.set(orderId, { currency: cell('order_currency')?.valueText ?? null, firstShippedAt })
  }
  return facts
}

/**
 * Whether this memo reverses revenue that was ever recognised (§3.1 item 3).
 *
 * A NATIVE memo always does - it exists only where an invoice was issued. A
 * CHANNEL memo does only when its order shipped on or before the memo's date,
 * because `build-fulfillment-entry.ts` recognised nothing otherwise. The CM-0091
 * case: a channel memo on an order that never shipped would reverse revenue that
 * is not in the books, in an entry that still balances.
 */
function resolveReverseRevenue(
  source: string,
  order: OrderFacts | undefined,
  issuedAt: string
): boolean {
  if (source !== 'channel') return true
  const firstShippedAt = order?.firstShippedAt
  return firstShippedAt !== null && firstShippedAt !== undefined && firstShippedAt <= issuedAt
}

/**
 * Where each memo's refund comes back out of: `creditMemoId -> GL account id`.
 *
 * 🛑 **Per memo, and never collapsed** (§3.1 item 1). An Affirm memo and a card
 * memo in one group must stay two credit lines or `1210` is overstated forever
 * in an entry that balances and that nothing downstream can detect.
 *
 * ⚠️ This is `resolveSettlementAccount` (`credit-memos/writes.ts`) made
 * set-based, and the one deliberate duplication in this module. That function
 * reads ONE order's gateways per call plus, without pre-loaded routes, the
 * org's whole `payment_gateway` table - 2,122 queries over a 1,061-memo backlog,
 * which is the shape §4.3 exists to escape. What is duplicated is only its
 * fallback rule (no order, no gateway, more than one gateway, no matching
 * record); the MATCH itself is `matchGatewayRoute`, shared with the sale side
 * and with the single-memo door, so one gateway cannot resolve two ways.
 *
 * A memo absent from the map takes the `clearing_card` role, which is
 * `resolveSettlementAccount`'s fallback and is deliberately NOT a refusal: a
 * refund cannot be refused, because the money has already moved, and
 * `clearing_card` is where a wrong answer fails to reconcile visibly (§7).
 */
export async function readCreditMemoSettlementAccounts(
  db: Database,
  params: { organizationId: string; memos: readonly UnpostedCreditMemo[] }
): Promise<Result<Map<string, string>, Error>> {
  const { organizationId, memos } = params

  return guard(
    async () => {
      const accounts = new Map<string, string>()
      // Only a CHANNEL memo that actually paid something back has a money leg;
      // a native memo's refund moves as a `PaymentTransaction` (`plan.ts`).
      const settling = memos.filter(
        (memo) => memo.source === 'channel' && memo.orderId && memo.amountRefundedMinor > 0
      )
      if (settling.length === 0) return accounts

      const orderIds = [...new Set(settling.map((memo) => memo.orderId as string))]
      const fields = await resolveFields(organizationId, ['order_payment_gateways'])
      if (!fields.order_payment_gateways) return accounts

      // ONE read of the routing table for the whole batch, and ONE read of the
      // orders' gateways. Both are the per-memo reads the single-memo door makes.
      const [routes, buckets] = await Promise.all([
        listPaymentGateways(db, organizationId).then((result) =>
          result.isOk() ? toGatewayRoutes(result.value) : []
        ),
        selectValues(db, organizationId, orderIds, [fields.order_payment_gateways.id]),
      ])

      const byOrder = new Map<string, string | undefined>()
      for (const orderId of orderIds) {
        const { cells } = cellReader(fields, buckets.get(orderId))
        // ⚠️ TAGS, so the value is in `optionId` - one row per gateway, each an
        // option KEY that for a connector-provisioned option set IS the
        // gateway's name (`readOrderGateways` says the same). Reading
        // `valueText` alone returns nothing and every refund falls back to the
        // role, which is the silent version of the bug this read exists to fix.
        const gateways = cells('order_payment_gateways').flatMap((row) => {
          const value = row.optionId ?? row.valueText
          return value ? [value] : []
        })
        // An order with TWO gateways takes the role too: the fulfillment fork
        // excludes that shipment as `gateway-ambiguous`, but a refund cannot
        // refuse, so it lands in the account a person reconciling is looking at.
        byOrder.set(
          orderId,
          gateways.length === 1 ? matchGatewayRoute(gateways[0] as string, routes) : undefined
        )
      }

      for (const memo of settling) {
        const glAccountId = byOrder.get(memo.orderId as string)
        if (glAccountId) accounts.set(memo.creditMemoId, glAccountId)
      }
      return accounts
    },
    'Failed to resolve the credit memo settlement accounts',
    { organizationId, memos: memos.length }
  )
}

/**
 * Exclusion reasons that still block a month close.
 *
 * A memo the plan excludes for one of these needs a person: a currency the
 * ledger cannot hold, a record with no counterparty for its receivable.
 * `zero-value` recognises nothing and blocks nothing; `before-cutoff` and
 * `locked-period` describe months the close is not asking about; and
 * `not-issued` is deliberately absent (§7) - `countUnissuedChannelCreditMemos`
 * already refuses a close over an unissued CHANNEL draft, and a native draft is
 * a person's scratch pad rather than revenue the books are missing.
 *
 * ⚠️ `missing-contact` is in the set although §7 predates the reason. A memo
 * excluded for it is contra-revenue that cannot post at all, so it holds the
 * month open for exactly the reason `foreign-currency` does, and the remedy is
 * as concrete: fill the contact in.
 */
export const CLOSE_BLOCKING_EXCLUSION_REASONS: ReadonlySet<CreditMemoPostingExclusionReason> =
  new Set(['foreign-currency', 'missing-contact'])

/** The close's count of a plan: what would post, plus what a person still owes. */
export function countCloseBlockingCreditMemos(plan: CreditMemoPostingPlan): number {
  const owed = plan.exclusions.filter((e) => CLOSE_BLOCKING_EXCLUSION_REASONS.has(e.reason)).length
  return plan.footer.memos + owed
}

/**
 * How many credit memos in one book month still owe the ledger a posting.
 *
 * §9.1's close refusal reads this. `close-month.ts` and `verify-balance.ts`
 * already count unissued CHANNEL drafts; neither counts an ISSUED-but-unposted
 * memo, and that is safe only while issuing posts immediately. The moment memos
 * batch, an issued memo sits unposted until somebody runs the dialog, so a month
 * could be closed with its contra-revenue outside the books and `period-lock.ts`
 * would then refuse the entry that is owed into the month just certified.
 *
 * Counted through the SAME read and the SAME plan the dialog uses, so "the close
 * says 3 and the dialog shows 2" is unreachable, and so a memo the dialog
 * excludes for good ({@link CLOSE_BLOCKING_EXCLUSION_REASONS}) does not hold the
 * month open forever - the trap the first fulfillment drive hit, where one
 * zero-value order kept July unclosable after every day had posted.
 *
 * ⚠️ Never throws, and a caller must keep it that way: a broken read here must
 * not be able to hold an organization's books hostage.
 *
 * ⚠️ Planned WITHOUT the settlement accounts. They decide which account a credit
 * line names, never whether a memo posts, so the count is identical and one
 * query is saved on a path the close runs for every month.
 */
export async function countUnpostedCreditMemos(
  db: Database,
  params: { organizationId: string; month: string }
): Promise<Result<number, Error>> {
  const { organizationId, month } = params

  return guard(
    async () => {
      assertMonth(month, 'The month')
      const memos = await readUnpostedCreditMemos(db, {
        organizationId,
        range: monthRange(month),
      })
      if (memos.isErr()) throw memos.error
      if (memos.value.length === 0) return 0

      const settings = await readCreditMemoPostingSettings(db, organizationId)
      if (settings.isErr()) throw settings.error

      const plan = planCreditMemoPosting({
        memos: memos.value,
        grouping: 'day',
        // ⚠️ The close ISSUES nothing, so a draft is `not-issued` here whatever
        // the dialog is set to. It is deliberately not close-blocking either
        // (`CLOSE_BLOCKING_EXCLUSION_REASONS`): `countUnissuedChannelCreditMemos`
        // already refuses a close over an unissued channel draft.
        issueDrafts: false,
        cutoffPeriod: settings.value.cutoffPeriod,
        lockedThroughMonth: settings.value.lockedThroughMonth,
        ledgerCurrency: settings.value.ledgerCurrency,
        timeZone: settings.value.timeZone ?? 'UTC',
      })
      return countCloseBlockingCreditMemos(plan)
    },
    'Failed to count unposted credit memos',
    { organizationId, month }
  )
}

/**
 * The posting one memo is STAMPED with, and its current status.
 *
 * 🛑 The memo's ledger card reads this instead of `listPostingsForSource`
 * (§3.3). A batch entry's summarised legs carry `credit_memo_batch` with the
 * PERIOD KEY as their `sourceId` and its receivable legs carry `contact`, so no
 * line in the entry names the memo and a source-line lookup renders an empty
 * card over a memo that is perfectly well posted. `listOrderFulfillmentPostings`
 * is the same read for the same reason.
 *
 * A stamp naming a posting that no longer exists is dropped rather than rendered
 * as a broken link. An array although the stamp is scalar, so the card renders
 * one shape whether a memo posted on its own or inside a period entry.
 */
export async function listCreditMemoPostings(
  db: Database,
  params: { organizationId: string; creditMemoId: string }
): Promise<Result<CreditMemoPostingRef[], Error>> {
  const { organizationId, creditMemoId } = params

  return guard(
    async () => {
      const fields = await resolveFields(organizationId, [CREDIT_MEMO_GL_POSTING_ATTRIBUTE])
      const stampField = fields[CREDIT_MEMO_GL_POSTING_ATTRIBUTE]
      if (!stampField) return []

      const [stamp] = await db
        .select({ valueText: schema.FieldValue.valueText })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.entityId, creditMemoId),
            eq(schema.FieldValue.fieldId, stampField.id)
          )
        )
        .limit(1)

      const glPostingId = stamp?.valueText
      if (!glPostingId) return []

      const [posting] = await db
        .select({
          id: schema.GlPosting.id,
          docNumber: schema.GlPosting.docNumber,
          status: schema.GlPosting.status,
        })
        .from(schema.GlPosting)
        .where(
          and(
            eq(schema.GlPosting.organizationId, organizationId),
            eq(schema.GlPosting.id, glPostingId)
          )
        )
        .limit(1)
      if (!posting) return []

      return [
        { glPostingId: posting.id, docNumber: posting.docNumber ?? null, status: posting.status },
      ]
    },
    'Failed to read a credit memo posting',
    { organizationId, creditMemoId }
  )
}

/** Everything the plan needs that is an organization setting rather than a fact. */
export interface CreditMemoPostingSettings {
  /** `accounting.cutoffPeriod`, `YYYY-MM`, or null when the org keeps no books yet. */
  cutoffPeriod: string | null
  /** `ledger.lockedThroughMonth`, `YYYY-MM`, or null when nothing is closed. */
  lockedThroughMonth: string | null
  /**
   * `accounting.bookTimeZone`, or null when it is unset.
   *
   * 🛑 Null rather than a `'UTC'` default, and `run.ts` REFUSES on it. 44 lane
   * 4's rule: a run whose day boundaries were cut in the wrong zone dates a
   * return into the wrong month invisibly.
   */
  timeZone: string | null
  ledgerCurrency: string
}

/**
 * The four ambient values a run is decided against, read once.
 *
 * Mirrors `readFulfillmentPostingSettings` exactly, including that
 * `resolvePeriodLock` fails CLOSED on a malformed lock and that refusal is kept:
 * a bulk run is the last place to fall back to "nothing is closed".
 */
export async function readCreditMemoPostingSettings(
  _db: Database,
  organizationId: string
): Promise<Result<CreditMemoPostingSettings, Error>> {
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
    'Failed to read the credit memo posting settings',
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
