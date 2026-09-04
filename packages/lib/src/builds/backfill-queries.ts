// packages/lib/src/builds/backfill-queries.ts

/**
 * The ONE aggregate read behind the bulk builder: what has been ordered over a
 * range, and what production is already committed against it.
 *
 * `plans/money/tasks/44-auto-build-cutoff-and-backfill.md` sections 7.1 and
 * 7.1a. The pure decision that consumes this lives in `backfill-policy.ts` and
 * the contract both are written against is `backfill-types.ts`.
 *
 * Reads only, and no permission checks — the router asserts and hands the range
 * down (`docs/lib-module-guide.md` sections 5 and 6). The writes live in
 * `backfill-builds.ts`.
 *
 * 🛑 **This must not inherit the per-order cost of `readOrderRaisedBuilds`.**
 * That read is one query per order because `listBuilds` has no multi-order
 * filter, and the live lane absorbs it by chunking. The historical lane cannot:
 * its range is nine months of orders, and one read per order is the shape
 * batching exists to escape (section 4.1). So this file issues a **bounded five
 * queries regardless of how large the range is**, the way `loadAutoBuildOrders`
 * answers a whole batch in four:
 *
 * 1. demand — every line in the range that reaches a part, with its order's date
 * 2. coverage — every open build for those parts
 * 3. `part_quantity_on_hand` for those parts
 * 4. `part_kind` for those parts
 * 5. the bill-of-materials existence check, for the parts that could be built
 *
 * 🛑 **AB3 — demand is read off the NATIVE `order` / `line_item`, never
 * `shopify_orders`.** Only a native `line_item` carries `line_item_part`;
 * `shopify_line_items` carries a `variant` reference, which is a different
 * keyspace. Same rule, and the same reason, as `auto-build-queries.ts`.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNotNull, isNull, type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import { UnprocessableEntityError } from '../errors'
import { readPartQuantitiesOnHand } from './auto-build-queries'
import type { BackfillCoverage, BackfillDemandLine, BackfillPlanInput } from './backfill-types'
import { readPartKinds, requireBuildFieldContext } from './build-queries'
import { resolvePartKind } from './client'
import { guard } from './guard'

/**
 * Everything the pure plan needs that has to come out of the database.
 *
 * Declared as an `Omit` of the contract rather than restated, so a field added
 * to {@link BackfillPlanInput} is a compile error here rather than a silently
 * missing input. `grouping` and `timeZone` are the caller's — they are dialog
 * choices and an org setting, not reads.
 */
export type BackfillPlanReads = Omit<BackfillPlanInput, 'grouping' | 'timeZone'>

/** The half-open window the backfill was asked about, on the order's business date. */
export interface BackfillRange {
  /** Inclusive lower bound. */
  from: Date
  /** Exclusive upper bound. */
  to: Date
}

/**
 * The build statuses that count as committed production (section 7.1a).
 *
 * 🛑 **`completed` is deliberately absent, and that is the whole subtlety of
 * this read.** `completeBuild` writes a `build_produce` movement and
 * `recalculatePartQoH` re-SUMs the ledger, so a completed build's units already
 * ARE `part_quantity_on_hand`. Counting it here as well, while also subtracting
 * on hand, counts the same production twice and under-builds by exactly the
 * produced quantity. `canceled` is absent because it produced nothing.
 */
const COVERAGE_STATUSES = ['planned', 'in_progress'] as const

/** The order fields the demand read needs. Both optional; migration 109 provisions them. */
const ORDER_ATTRIBUTES = ['order_placed_at', 'order_cancelled_at'] as const

/** The line fields the demand read needs. Without the first two there is no demand. */
const LINE_ATTRIBUTES = ['line_item_order', 'line_item_part', 'line_item_qty'] as const

/** The subpart fields the bill-of-materials existence check needs. */
const SUBPART_ATTRIBUTES = [
  'subpart_parent_part',
  'subpart_child_part',
  'subpart_quantity',
] as const

/** An aliased `FieldValue` table, as `alias()` returns it. */
type FieldValueAlias = ReturnType<typeof alias<typeof schema.FieldValue, string>>

/**
 * Read everything the backfill plan is decided from, for one date range.
 *
 * The range is on the order's **business** date — `order_placed_at`, falling
 * back to the order row's `createdAt` — never on when the row was written. A
 * connector back-fill creates rows today carrying last year's date, and those
 * are precisely the orders this feature exists to build.
 *
 * Cancelled orders (`order_cancelled_at` non-null) contribute no demand.
 *
 * An org with no `order` or `line_item` definition, or with the line fields
 * unprovisioned, reads as **no demand** rather than as an error: there is
 * nothing to build from, and the preview showing an empty plan is the honest
 * answer. An org that HAS demand but no provisioned `build` entity is refused,
 * because reading coverage as empty there would plan builds for demand that is
 * already covered.
 */
export async function readBackfillPlanReads(
  db: Database,
  organizationId: string,
  range: BackfillRange
): Promise<Result<BackfillPlanReads, Error>> {
  return guard(
    async () => {
      const lines = await readDemandLines(db, organizationId, range)
      if (lines.length === 0) return emptyReads()

      const partIds = [...new Set(lines.map((line) => line.partId))]
      const placedByOrder = new Map<string, Date>()
      for (const line of lines) placedByOrder.set(line.orderId, line.placedAt)

      const [coverage, quantitiesOnHand, partKinds] = await Promise.all([
        readCoverage(db, organizationId, partIds, placedByOrder, range),
        readPartQuantitiesOnHand(db, organizationId, partIds),
        readPartKinds(db, organizationId, partIds),
      ])

      // Step 3 before step 2, as `reconcileOrderBuilds` does it: a purchased
      // part can never be built, so its bill of materials is never read.
      const buildablePartIds = partIds.filter(
        (partId) => resolvePartKind(partKinds.get(partId)) !== 'component'
      )
      const hasBom = await readHasBom(db, organizationId, buildablePartIds)

      return { lines, coverage, quantitiesOnHand, partKinds, hasBom }
    },
    'Failed to read the build backfill plan inputs',
    { organizationId, from: range.from, to: range.to }
  )
}

function emptyReads(): BackfillPlanReads {
  return {
    lines: [],
    coverage: [],
    quantitiesOnHand: new Map(),
    partKinds: new Map(),
    hasBom: new Map(),
  }
}

/**
 * Every order line in the range that reaches a part, uncollapsed.
 *
 * ONE query for the whole range. The order is joined rather than read in a
 * second pass keyed on a list of ids, so the cost does not scale with how many
 * orders the range happens to contain.
 *
 * ⚠️ The bucketing date is **selected from the same expression the range is
 * filtered on**, rather than being recomposed in TypeScript from a separate
 * `createdAt` column. `EntityInstance.createdAt` is `timestamp` without a zone
 * while `FieldValue.valueDate` is `timestamptz`, so a bare `coalesce` of the two
 * resolves through whatever the session timezone happens to be. `at time zone
 * 'UTC'` pins it, which is also exactly drizzle's own convention for reading a
 * zoneless column back (`mapFromDriverValue` appends `+0000`) — so the filter
 * and the bucket can never disagree about which side of a boundary an order
 * falls on.
 */
async function readDemandLines(
  db: Database,
  organizationId: string,
  range: BackfillRange
): Promise<BackfillDemandLine[]> {
  const [orderDefId, lineDefId] = await Promise.all([
    getCachedEntityDefId(organizationId, 'order'),
    getCachedEntityDefId(organizationId, 'line_item'),
  ])
  if (!orderDefId || !lineDefId) return []

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...ORDER_ATTRIBUTES, ...LINE_ATTRIBUTES])

  const lineOrderField = fields.line_item_order
  const linePartField = fields.line_item_part
  if (!lineOrderField || !linePartField) return []

  const orderInstance = alias(schema.EntityInstance, 'backfill_order_ei')
  const lineOrderValue = alias(schema.FieldValue, 'backfill_line_order_v')
  const linePartValue = alias(schema.FieldValue, 'backfill_line_part_v')
  const lineQtyValue = alias(schema.FieldValue, 'backfill_line_qty_v')
  const orderPlacedValue = alias(schema.FieldValue, 'backfill_order_placed_v')
  const orderCancelledValue = alias(schema.FieldValue, 'backfill_order_cancelled_v')

  const placedAt = sql<string>`
    coalesce(${orderPlacedValue.valueDate}, ${orderInstance.createdAt} at time zone 'UTC')
  `

  const rows = await db
    .select({
      orderId: orderInstance.id,
      partId: linePartValue.relatedEntityId,
      quantity: lineQtyValue.valueNumber,
      placedAt,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      lineOrderValue,
      ownValue(lineOrderValue, schema.EntityInstance.id, organizationId, lineOrderField.id)
    )
    .innerJoin(
      orderInstance,
      and(
        eq(orderInstance.id, lineOrderValue.relatedEntityId),
        eq(orderInstance.organizationId, organizationId),
        eq(orderInstance.entityDefinitionId, orderDefId),
        isNull(orderInstance.archivedAt)
      )
    )
    .innerJoin(
      linePartValue,
      and(
        ownValue(linePartValue, schema.EntityInstance.id, organizationId, linePartField.id),
        isNotNull(linePartValue.relatedEntityId)
      )
    )
    .leftJoin(
      lineQtyValue,
      ownValue(
        lineQtyValue,
        schema.EntityInstance.id,
        organizationId,
        fieldId(fields.line_item_qty)
      )
    )
    .leftJoin(
      orderPlacedValue,
      ownValue(orderPlacedValue, orderInstance.id, organizationId, fieldId(fields.order_placed_at))
    )
    // A LEFT JOIN plus `IS NULL`, so an order with no cancellation ROW at all is
    // kept alongside one whose row is present and empty. An inner join would
    // drop the first group, which is almost every order there is.
    .leftJoin(
      orderCancelledValue,
      ownValue(
        orderCancelledValue,
        orderInstance.id,
        organizationId,
        fieldId(fields.order_cancelled_at)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, lineDefId),
        isNull(schema.EntityInstance.archivedAt),
        isNull(orderCancelledValue.valueDate),
        sql`${placedAt} >= ${range.from}`,
        sql`${placedAt} < ${range.to}`
      )
    )

  const lines: BackfillDemandLine[] = []
  for (const row of rows) {
    if (!row.orderId || !row.partId) continue
    const placed = toDate(row.placedAt)
    if (!placed) continue
    lines.push({
      orderId: row.orderId,
      partId: row.partId,
      // A line with no `line_item_qty` reads 0, exactly as `loadAutoBuildOrders`
      // reads it. The policy is what decides a non-positive line contributes
      // nothing; a reader that dropped it here would hide the order from the
      // drill-down as well.
      quantity: row.quantity == null ? 0 : Number(row.quantity),
      placedAt: placed,
    })
  }
  return lines
}

/**
 * Committed production for these parts, attributed to a point in the range.
 *
 * ONE query. Only `planned` and `in_progress` builds are read — see
 * {@link COVERAGE_STATUSES} for why a `completed` build must not be here — and
 * every source is included, `manual` along with `order` and `batch`.
 *
 * 🛑 **Including `manual` DIVERGES from `reconcile-policy.ts`'s rule that a
 * manual build does not block a raise, and it does so deliberately (section
 * 7.1a).** That rule answers *does this order have its build?*, where blocking
 * on a manual build would suppress an order's build set forever. This read
 * answers a different question — *is enough production already planned for this
 * demand?* — and a planned manual build will produce units, so it answers yes.
 * Do not align the two.
 *
 * Attribution, and it is what bounds the answer to the range:
 *
 * - a build carrying `build_order` resolves to that order's date, taken from
 *   the demand read's own map. An order that is not in that map is out of the
 *   range (or cancelled), so its build covers demand this run is not looking at
 *   and is **dropped** rather than counted as undated coverage;
 * - a build carrying a demand period is kept when the period OVERLAPS the
 *   range, not only when it starts inside it — a January build still covers the
 *   first half of a January-15 range;
 * - anything else is undated coverage, which sorts first.
 */
async function readCoverage(
  db: Database,
  organizationId: string,
  partIds: string[],
  placedByOrder: ReadonlyMap<string, Date>,
  range: BackfillRange
): Promise<BackfillCoverage[]> {
  if (partIds.length === 0) return []

  // Refuses when the org has no `build` def, no `build_status` or no
  // `build_part`. Deliberately louder than the demand read: this org HAS demand,
  // and reading its coverage as empty would plan builds on top of production
  // that already exists.
  const ctx = await requireBuildFieldContext(organizationId)
  const partField = ctx.fields.build_part
  const statusField = ctx.fields.build_status
  const quantityField = ctx.fields.build_quantity_planned
  const orderField = ctx.fields.build_order
  if (!partField || !statusField || !quantityField || !orderField) {
    throw new UnprocessableEntityError(
      'Backfilling builds is not available until the build part, status, quantity and order fields are provisioned'
    )
  }

  const partValue = alias(schema.FieldValue, 'backfill_build_part_v')
  const statusValue = alias(schema.FieldValue, 'backfill_build_status_v')
  const quantityValue = alias(schema.FieldValue, 'backfill_build_qty_v')
  const orderValue = alias(schema.FieldValue, 'backfill_build_order_v')
  const reversalValue = alias(schema.FieldValue, 'backfill_build_reversal_v')
  const periodStartValue = alias(schema.FieldValue, 'backfill_build_period_start_v')
  const periodEndValue = alias(schema.FieldValue, 'backfill_build_period_end_v')

  const rows = await db
    .select({
      buildPartId: partValue.relatedEntityId,
      plannedQuantity: quantityValue.valueNumber,
      buildOrderId: orderValue.relatedEntityId,
      periodStart: periodStartValue.valueDate,
      periodEnd: periodEndValue.valueDate,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      partValue,
      and(
        ownValue(partValue, schema.EntityInstance.id, organizationId, partField.id),
        inArray(partValue.relatedEntityId, partIds)
      )
    )
    .innerJoin(
      statusValue,
      and(
        ownValue(statusValue, schema.EntityInstance.id, organizationId, statusField.id),
        inArray(statusValue.optionId, [...COVERAGE_STATUSES])
      )
    )
    .leftJoin(
      quantityValue,
      ownValue(quantityValue, schema.EntityInstance.id, organizationId, quantityField.id)
    )
    .leftJoin(
      orderValue,
      ownValue(orderValue, schema.EntityInstance.id, organizationId, orderField.id)
    )
    // Belt and braces: a reversal and the build it reverses are both `completed`,
    // so the status filter already excludes them. Asserted anyway, because the
    // day a reversal can be raised against an open build this read would start
    // counting production that nets out to nothing.
    .leftJoin(
      reversalValue,
      ownValue(
        reversalValue,
        schema.EntityInstance.id,
        organizationId,
        fieldId(ctx.fields.build_reversal_of)
      )
    )
    .leftJoin(
      periodStartValue,
      ownValue(
        periodStartValue,
        schema.EntityInstance.id,
        organizationId,
        fieldId(ctx.fields.build_period_start)
      )
    )
    .leftJoin(
      periodEndValue,
      ownValue(
        periodEndValue,
        schema.EntityInstance.id,
        organizationId,
        fieldId(ctx.fields.build_period_end)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.buildDefId),
        isNull(schema.EntityInstance.archivedAt),
        isNull(reversalValue.relatedEntityId)
      )
    )

  const coverage: BackfillCoverage[] = []
  for (const row of rows) {
    if (!row.buildPartId) continue
    const quantity = row.plannedQuantity == null ? 0 : Number(row.plannedQuantity)
    // A build planning nothing commits no production. Dropped here rather than
    // handed to the policy as a zero, so the coverage list is only ever things
    // that actually cover something.
    if (!Number.isFinite(quantity) || quantity <= 0) continue

    if (row.buildOrderId) {
      const placedAt = placedByOrder.get(row.buildOrderId)
      if (!placedAt) continue
      coverage.push({ partId: row.buildPartId, quantity, appliesAt: placedAt })
      continue
    }

    const periodStart = toDate(row.periodStart)
    if (periodStart) {
      const periodEnd = toDate(row.periodEnd) ?? periodStart
      if (periodStart >= range.to || periodEnd <= range.from) continue
      coverage.push({ partId: row.buildPartId, quantity, appliesAt: periodStart })
      continue
    }

    coverage.push({ partId: row.buildPartId, quantity, appliesAt: null })
  }
  return coverage
}

/**
 * Does each part have at least one direct subpart?
 *
 * ONE query for every part, rather than `loadDirectSubparts` per part.
 * `reconcileOrderBuilds` calls that function in a loop because it is answering
 * for one order's handful of parts; the backfill's range reaches every part the
 * org has ever sold, and the answer it needs is only ever a boolean. Same edge
 * semantics as `loadDirectSubparts`: a non-archived `subpart` in this org whose
 * parent is the part, carrying a child and a positive quantity.
 *
 * A part absent from the result reads as `false`, which is what the contract
 * says. Parts already known to be `component` are never asked about.
 */
async function readHasBom(
  db: Database,
  organizationId: string,
  partIds: string[]
): Promise<Map<string, boolean>> {
  const hasBom = new Map<string, boolean>()
  if (partIds.length === 0) return hasBom

  const subpartDefId = await getCachedEntityDefId(organizationId, 'subpart')
  if (!subpartDefId) return hasBom

  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...SUBPART_ATTRIBUTES])
  const parentField = fields.subpart_parent_part
  const childField = fields.subpart_child_part
  const qtyField = fields.subpart_quantity
  if (!parentField || !childField || !qtyField) return hasBom

  const parentValue = alias(schema.FieldValue, 'backfill_subpart_parent_v')
  const childValue = alias(schema.FieldValue, 'backfill_subpart_child_v')
  const qtyValue = alias(schema.FieldValue, 'backfill_subpart_qty_v')

  const rows = await db
    .select({ parentPartId: parentValue.relatedEntityId })
    .from(schema.EntityInstance)
    .innerJoin(
      parentValue,
      and(
        ownValue(parentValue, schema.EntityInstance.id, organizationId, parentField.id),
        inArray(parentValue.relatedEntityId, partIds)
      )
    )
    .innerJoin(
      childValue,
      and(
        ownValue(childValue, schema.EntityInstance.id, organizationId, childField.id),
        isNotNull(childValue.relatedEntityId)
      )
    )
    .innerJoin(
      qtyValue,
      and(
        ownValue(qtyValue, schema.EntityInstance.id, organizationId, qtyField.id),
        sql`${qtyValue.valueNumber} > 0`
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, subpartDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  for (const row of rows) {
    if (row.parentPartId) hasBom.set(row.parentPartId, true)
  }
  return hasBom
}

/**
 * Join predicate for "this instance's value of <field>".
 *
 * Takes the alias OBJECT and composes with `eq`, so drizzle emits the table as
 * an identifier. A hand-written `sql` fragment interpolating a table binds it as
 * a parameter instead, which is a mistake this codebase has already paid for
 * (`build-queries.ts`).
 */
function ownValue(
  value: FieldValueAlias,
  ownerId: AnyPgColumn,
  organizationId: string,
  fieldId: string
): SQL | undefined {
  return and(
    eq(value.entityId, ownerId),
    eq(value.organizationId, organizationId),
    eq(value.fieldId, fieldId)
  )
}

/**
 * A materialised field's id, or a sentinel that matches no row.
 *
 * Every optional field below is reached through a LEFT JOIN, so joining on an
 * id that cannot exist gives exactly the behaviour an unmaterialised field
 * should have — the column reads `null`, and the `coalesce` fallback or the
 * `IS NULL` predicate above it takes over. The alternative, adding the join
 * conditionally, changes drizzle's nullability type on every branch and is what
 * turns one static query into four.
 *
 * 🛑 It follows that a MISSING field is silently indistinguishable from an
 * empty value here. That is safe only because every field it is used on is
 * optional by design: none of them is a filter whose absence would WIDEN the
 * answer. The four whose absence would — `build_part`, `build_status`,
 * `build_quantity_planned`, `build_order` — are required outright above, for
 * the reason `reconcile-queries.ts` gives about silently dropped filters.
 */
function fieldId(field: { id: string } | null | undefined): string {
  return field?.id ?? '__unmaterialised__'
}

/**
 * Read a date column back as a `Date`.
 *
 * `FieldValue.valueDate` is declared `mode: 'string'` while a `timestamptz`
 * expression comes back from the driver already parsed, so both shapes reach
 * here. An unparseable value is `null` rather than an Invalid Date, because an
 * Invalid Date compares false against everything and would silently vanish from
 * the arithmetic much later.
 */
function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
