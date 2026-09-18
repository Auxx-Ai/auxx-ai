// packages/lib/src/returns/reads.ts

/**
 * Every READ over `return`, `return_line` and `return_part_line`: the list page
 * and its saved views, the detail surfaces, and the two numbers the over-return
 * guard is fed from.
 *
 * plans/money/tasks/54-returns.md sections 3.1 to 3.6.
 *
 * Two things in here are the whole point of the list and are derived rather
 * than stored, exactly as the plan insists:
 *
 * 1. **"Unidentified" is `contact IS NULL`** (section 3.2), never a status
 *    value. About 15% of returns are an unannounced pallet on the dock and the
 *    record has to exist before anyone knows whose it is, so identification and
 *    lifecycle are different axes. The dock queue is a saved view over the null,
 *    oldest first, because every day one sits there is a day closer to a
 *    chargeback deadline nobody can answer.
 * 2. **"Credited but not inspected"** (section 3.3) is credit memos linked while
 *    the status is still short of `inspected`: the money is gone and the damage
 *    argument went with it. Surfaced, **never blocked** - there are good
 *    commercial reasons to refund fast, and the system's job is to say what was
 *    just given up.
 *
 * Instances and their cells come from `resources/system-records`; the SQL here
 * is only what that reader cannot express - the value-keyed filters behind the
 * saved views and the two quantity aggregates.
 *
 * Reads only. The writes are in `writes.ts`, because a file that both queries
 * and mutates is the first step back toward a service class
 * (`docs/lib-module-guide.md` section 5). No permission checks: the router
 * asserts (section 6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, desc, eq, exists, inArray, isNotNull, isNull, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { NotFoundError } from '../errors'
import { CREDIT_MEMO_FIELDS } from '../resources/registry/resources/credit-memo-fields'
import { FULFILLMENT_FIELDS } from '../resources/registry/resources/fulfillment-fields'
import { FULFILLMENT_LINE_FIELDS } from '../resources/registry/resources/fulfillment-line-fields'
import { LINE_ITEM_FIELDS } from '../resources/registry/resources/line-item-fields'
import { pickSystemAttributes } from '../resources/registry/system-attributes'
import { type RecordId, toRecordId } from '../resources/resource-id'
import {
  inPageOrder,
  readSystemRecords,
  type SystemRecord,
  systemFieldMap,
  systemFields,
  systemValueJoin,
} from '../resources/system-records'
import {
  loadReturnFieldContext,
  loadReturnLineFieldContext,
  loadReturnPartLineFieldContext,
  type ReturnAttribute,
  type ReturnFieldContext,
  type ReturnLineAttribute,
  type ReturnLineFieldContext,
  type ReturnPartLineAttribute,
  type ReturnPartLineFieldContext,
} from './fields'
import { guard } from './guard'
import type { ReturnedQuantityClaim } from './over-return-guard'
import {
  PRE_INSPECTION_RETURN_STATUSES,
  type ReturnLineConditionGrade,
  type ReturnLineLiability,
  type ReturnOrigin,
  type ReturnStatus,
  toReturnStatus,
} from './status'
import type { SalvageStatus } from './types'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** One `return`, with everything the list row and the header need. */
export interface ReturnRecord {
  returnId: string
  recordId: RecordId
  number: string | null
  status: ReturnStatus | null
  origin: ReturnOrigin | null
  /** TAGS: a return may legitimately carry two reasons (wrong item AND damaged). */
  reasons: string[]
  /** The customer's own words, verbatim, beside the normalized {@link reasons} tags. */
  customerNote: string | null
  contactId: string | null
  orderId: string | null
  ticketId: string | null
  requestedAt: Date | null
  receivedAt: Date | null
  inspectedAt: Date | null
  closedAt: Date | null
  senderNameRaw: string | null
  senderAddressRaw: string | null
  inboundCarrier: string | null
  /** One per parcel, in `sortKey` order; the first is the primary. Migration 155. */
  inboundTracking: string[]
  labelProvided: boolean | null
  /** Integer minor units. */
  labelCost: number | null
  /** Integer minor units, transcribed rather than computed. */
  goodsValue: number | null
  /** Integer minor units, rolled up from the linked memos. Derived, never typed. */
  creditedAmount: number | null
  /** Integer minor units: `goodsValue - creditedAmount`. No GL effect. */
  withheldAmount: number | null
  withheldReason: string | null
  /** `EntityInstance` ids of the linked credit memos. The FK is on the memo. */
  creditMemoIds: string[]
  /** Derived from `contact IS NULL` (section 3.2). Never a status value. */
  unidentified: boolean
  /** The risk state of section 3.3: memos linked, nothing inspected. */
  creditedNotInspected: boolean
  createdAt: Date
}

/** One `return_line`: the commercial fact and the evidence anchor. */
export interface ReturnLineRecord {
  returnLineId: string
  recordId: RecordId
  returnId: string | null
  lineItemId: string | null
  partId: string | null
  quantity: number | null
  conditionGrade: ReturnLineConditionGrade | null
  liability: ReturnLineLiability | null
  inspectionNotes: string | null
  inspectedByUserId: string | null
  inspectedAt: Date | null
  createdAt: Date
}

/**
 * One materialized `return_part_line`.
 *
 * Structurally a `MaterializedSalvageRow` plus the fields the tree does not
 * need, so it can be handed straight to `buildSalvageTree`.
 */
export interface ReturnPartLineRecord {
  id: string
  recordId: RecordId
  returnLineId: string | null
  parentId: string | null
  partId: string
  quantity: number
  status: SalvageStatus
  salvagePercent: number
  sortOrder: string | null
  /** Integer minor units, frozen by the salvage writer. Null until then. */
  unitCost: number | null
  /** The `return_in` this row produced, on the rows that produced one. */
  movementId: string | null
  createdAt: Date
}

/** A return with its lines, for the detail page and the evidence pack. */
export interface ReturnWithLines extends ReturnRecord {
  lines: ReturnLineRecord[]
}

/** A return line with whatever of its teardown checklist has been materialized. */
export interface ReturnLineWithPartLines extends ReturnLineRecord {
  partLines: ReturnPartLineRecord[]
}

/** The saved views of sections 3.2 and 3.3, expressed as filters applied in SQL. */
export interface ListReturnsFilters {
  status?: readonly ReturnStatus[]
  /**
   * `true` is the dock queue: returns with no contact. `false` is the
   * complement. Omitted means both.
   */
  unidentified?: boolean
  /**
   * `true` restricts to returns carrying at least one credit memo while the
   * status is still short of `inspected` (section 3.3). It NARROWS any `status`
   * filter given alongside it rather than replacing it.
   */
  creditedNotInspected?: boolean
  contactId?: string
  orderId?: string
  ticketId?: string
  /** `oldest` is what the dock queue wants: the longest-waiting pallet first. */
  sort?: 'newest' | 'oldest'
  limit?: number
  offset?: number
}

/**
 * Returns matching the filters, newest first unless asked otherwise.
 *
 * Every filter is applied in SQL, so a caller asking for page two gets page two
 * of the filtered set rather than page two of everything with the tail thrown
 * away (`docs/lib-module-guide.md` section 6).
 *
 * An organization with no `return` definition reads as an empty list rather
 * than an error: it has no returns, which is a fact and not a failure.
 */
export async function listReturns(
  db: Database,
  organizationId: string,
  filters: ListReturnsFilters = {}
): Promise<Result<ReturnRecord[], Error>> {
  return guard(
    async () => {
      const ctx = await loadReturnFieldContext(db, organizationId)
      if (!ctx) return []

      const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
      const offset = filters.offset ?? 0
      const where: SQL[] = [
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.defId),
        isNull(schema.EntityInstance.archivedAt),
      ]

      let query = db.select({ id: schema.EntityInstance.id }).from(schema.EntityInstance).$dynamic()

      // The risk view narrows the status set rather than owning it, so
      // `status: ['received'], creditedNotInspected: true` means what it reads
      // like instead of one silently winning.
      const statuses = resolveStatusFilter(filters)
      if (statuses && ctx.fields.return_status) {
        if (statuses.length === 0) return []
        const statusValue = alias(schema.FieldValue, 'return_status_v')
        query = query.innerJoin(
          statusValue,
          and(
            systemValueJoin(statusValue, ctx.fields.return_status.id),
            inArray(statusValue.optionId, [...statuses])
          )
        )
      }

      if (filters.unidentified !== undefined && ctx.fields.return_contact) {
        const contactValue = alias(schema.FieldValue, 'return_unidentified_v')
        query = query.leftJoin(
          contactValue,
          systemValueJoin(contactValue, ctx.fields.return_contact.id)
        )
        where.push(
          filters.unidentified
            ? isNull(contactValue.relatedEntityId)
            : isNotNull(contactValue.relatedEntityId)
        )
      }

      for (const [value, attribute, name] of [
        [filters.contactId, 'return_contact', 'return_contact_v'],
        [filters.orderId, 'return_order', 'return_order_v'],
        [filters.ticketId, 'return_ticket', 'return_ticket_v'],
      ] as const) {
        const field = ctx.fields[attribute]
        if (!value || !field) continue
        const related = alias(schema.FieldValue, name)
        query = query.innerJoin(
          related,
          and(systemValueJoin(related, field.id), eq(related.relatedEntityId, value))
        )
      }

      if (filters.creditedNotInspected) {
        const memoFieldId = await loadCreditMemoReturnFieldId(db, organizationId)
        // No `credit_memo.return` field means no memo can be linked to any
        // return, so nothing can be in the risk state. An empty list is the
        // honest answer; a missing predicate would return every return.
        if (!memoFieldId) return []
        where.push(linkedCreditMemoExists(db, organizationId, memoFieldId))
      }

      const rows = await query
        .where(and(...where))
        .orderBy(
          filters.sort === 'oldest'
            ? asc(schema.EntityInstance.createdAt)
            : desc(schema.EntityInstance.createdAt)
        )
        .limit(limit)
        .offset(offset)

      if (rows.length === 0) return []
      const page = rows.map((row) => row.id)
      const records = await readSystemRecords(db, organizationId, ctx, { ids: page })
      return hydrateReturns(db, organizationId, ctx, inPageOrder(records, page))
    },
    'Failed to list returns',
    { organizationId, filters }
  )
}

/**
 * One return with its lines, or null when it does not exist, is archived, or
 * belongs to another organization.
 *
 * The three cases are deliberately indistinguishable, so this cannot be used to
 * probe for ids.
 */
export async function getReturn(
  db: Database,
  organizationId: string,
  returnId: string
): Promise<Result<ReturnWithLines | null, Error>> {
  return guard(
    async () => {
      const ctx = await loadReturnFieldContext(db, organizationId)
      if (!ctx) return null

      const records = await readSystemRecords(db, organizationId, ctx, { ids: [returnId] })
      const [record] = await hydrateReturns(db, organizationId, ctx, records)
      if (!record) return null

      const lines = await readReturnLinesByReturn(db, organizationId, returnId)
      return { ...record, lines }
    },
    'Failed to read return',
    { organizationId, returnId }
  )
}

/**
 * One return line with the `return_part_line` rows that have been materialized
 * for it.
 *
 * The rows, not the tree: a node with no row is `undecided` by absence
 * (section 6.6), and turning absence into nodes is `salvage-reads.ts`'s job
 * because it needs the bill of materials to do it.
 */
export async function getReturnLine(
  db: Database,
  organizationId: string,
  returnLineId: string
): Promise<Result<ReturnLineWithPartLines | null, Error>> {
  return guard(
    async () => {
      const line = await readReturnLine(db, organizationId, returnLineId)
      if (!line) return null
      const partLines = await readReturnPartLines(db, organizationId, returnLineId)
      return { ...line, partLines }
    },
    'Failed to read return line',
    { organizationId, returnLineId }
  )
}

/** Every return line on one return, oldest first. */
export async function readReturnLinesByReturn(
  db: Database,
  organizationId: string,
  returnId: string
): Promise<ReturnLineRecord[]> {
  const ctx = await loadReturnLineFieldContext(db, organizationId)
  if (!ctx) return []
  const records = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: 'return_line_return', in: [returnId] },
  })
  return records.map((record) => toReturnLineRecord(ctx, record))
}

/** One return line, or null. */
export async function readReturnLine(
  db: Database,
  organizationId: string,
  returnLineId: string
): Promise<ReturnLineRecord | null> {
  const ctx = await loadReturnLineFieldContext(db, organizationId)
  if (!ctx) return null
  const [record] = await readSystemRecords(db, organizationId, ctx, { ids: [returnLineId] })
  return record ? toReturnLineRecord(ctx, record) : null
}

/** {@link readReturnLine}, as the `NotFoundError` a write path needs. */
export async function requireReturnLine(
  db: Database,
  organizationId: string,
  returnLineId: string
): Promise<ReturnLineRecord> {
  const line = await readReturnLine(db, organizationId, returnLineId)
  if (!line) throw new NotFoundError(`Return line ${returnLineId} not found`)
  return line
}

/**
 * Every materialized `return_part_line` under one return line.
 *
 * The whole checklist in one read, which is why `return_part_line_return_line`
 * is carried on every row in the tree rather than only on the roots.
 */
export async function readReturnPartLines(
  db: Database,
  organizationId: string,
  returnLineId: string
): Promise<ReturnPartLineRecord[]> {
  const ctx = await loadReturnPartLineFieldContext(db, organizationId)
  if (!ctx) return []
  const records = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: 'return_part_line_return_line', in: [returnLineId] },
  })
  return records.map((record) => toReturnPartLineRecord(ctx, record))
}

/** One materialized part line, or null. Used by the write paths to re-read a row. */
export async function readReturnPartLine(
  db: Database,
  organizationId: string,
  partLineId: string
): Promise<ReturnPartLineRecord | null> {
  const ctx = await loadReturnPartLineFieldContext(db, organizationId)
  if (!ctx) return null
  const [record] = await readSystemRecords(db, organizationId, ctx, { ids: [partLineId] })
  return record ? toReturnPartLineRecord(ctx, record) : null
}

// ─── The over-return guard's two inputs ─────────────────────────────

/**
 * A connection OR an open transaction.
 *
 * 🛑 The over-return guard (`resources/hooks/return-hooks.ts`) runs as a
 * pre-write hook and passes the AMBIENT WRITE DB, which is a `Transaction`
 * whenever the write is in one. Narrowing these reads to `Database` would force
 * the guard onto a second connection, where it cannot see the rows the write in
 * flight has not committed yet - so two return lines written in one transaction
 * would each be measured against a ceiling the other had not yet consumed, and
 * the pair could breach it together while each passed alone.
 */
type ReturnsReadDb = Database | Transaction

/** One credit memo on the order that no return has claimed. */
export interface UnlinkedCreditMemo {
  creditMemoId: string
  number: string | null
  /** Minor units, as transcribed by the connector. Never recomputed. */
  total: number | null
  status: string | null
  issuedAt: Date | null
}

export interface ReturnableQuantity {
  lineItemId: string
  /** The most units that may EVER come back, or null when nothing records it. */
  ceiling: number | null
  /** Units already claimed by other return lines, across every return. */
  alreadyReturned: number
  /** `ceiling - alreadyReturned`, never negative, or null when the ceiling is unknown. */
  remaining: number | null
  /** Dispatches, the sold quantity, or neither. */
  ceilingSource: 'shipped' | 'sold' | 'unknown'
}

/** What a line item's ceiling is and where it came from. */
export interface ReturnCeiling {
  ceiling: number | null
  ceilingSource: 'shipped' | 'sold' | 'unknown'
}

/**
 * Every `return_line` already pointing at each `line_item`, across ALL returns.
 *
 * The grain is one row per sold line PER CONDITION, so several rows routinely
 * point at one line item and a per-row check is useless. This is the set
 * `checkOverReturn` sums.
 *
 * One query for the whole list. A line item with no claims is absent from the
 * map, which reads the same as an empty list at every call site.
 */
export async function readReturnedQuantityClaimsBatch(
  db: ReturnsReadDb,
  organizationId: string,
  lineItemIds: readonly string[]
): Promise<Map<string, ReturnedQuantityClaim[]>> {
  const byLineItem = new Map<string, ReturnedQuantityClaim[]>()
  const ids = [...new Set(lineItemIds)]
  if (ids.length === 0) return byLineItem

  const ctx = await loadReturnLineFieldContext(db, organizationId)
  const lineItemField = ctx?.fields.return_line_line_item
  const quantityField = ctx?.fields.return_line_quantity
  if (!ctx || !lineItemField || !quantityField) return byLineItem

  const lineItemValue = alias(schema.FieldValue, 'rl_line_item_v')
  const quantityValue = alias(schema.FieldValue, 'rl_quantity_v')

  const rows = await db
    .select({
      id: schema.EntityInstance.id,
      lineItemId: lineItemValue.relatedEntityId,
      quantity: quantityValue.valueNumber,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      lineItemValue,
      and(
        systemValueJoin(lineItemValue, lineItemField.id),
        inArray(lineItemValue.relatedEntityId, ids)
      )
    )
    .leftJoin(quantityValue, systemValueJoin(quantityValue, quantityField.id))
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.defId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  for (const row of rows) {
    if (!row.lineItemId) continue
    const bucket = byLineItem.get(row.lineItemId) ?? []
    bucket.push({ returnLineId: row.id, quantity: row.quantity ?? 0 })
    byLineItem.set(row.lineItemId, bucket)
  }
  return byLineItem
}

/** {@link readReturnedQuantityClaimsBatch} for one sold line. */
export async function readReturnedQuantityClaims(
  db: ReturnsReadDb,
  organizationId: string,
  lineItemId: string
): Promise<ReturnedQuantityClaim[]> {
  const byLineItem = await readReturnedQuantityClaimsBatch(db, organizationId, [lineItemId])
  return byLineItem.get(lineItemId) ?? []
}

/**
 * How many units a sold line is allowed to take back, and how many already
 * have been.
 *
 * 🔑 **The ceiling is what SHIPPED, not what sold** (section 3.5): the sum of
 * the line's `fulfillment_line` quantities, excluding dispatches whose
 * `fulfillment_status` is `cancelled`. A line ordered 5 and shipped 2 can have
 * at most 2 come back, where the sold ceiling would wave through a return of
 * three units against a line that shipped two - which is exactly the case that
 * restocks parts for a unit that never left.
 *
 * ⚠️ **Falls back to the sold quantity when the line has no fulfillment lines
 * at all**, which is every line on an order predating the dispatch re-sync. The
 * guard tightens where the data exists and never gets looser than the old rule
 * where it does not. `ceilingSource` says which happened, so a surface can
 * explain the number rather than merely enforce it.
 */
export async function readReturnableQuantity(
  db: Database,
  organizationId: string,
  lineItemId: string,
  options: { excludeReturnLineId?: string | null } = {}
): Promise<Result<ReturnableQuantity, Error>> {
  return guard(
    async () => {
      const { ceiling, ceilingSource } = await readReturnCeiling(db, organizationId, lineItemId)
      const claims = await readReturnedQuantityClaims(db, organizationId, lineItemId)
      const alreadyReturned = claims
        .filter(
          (claim) =>
            !options.excludeReturnLineId || claim.returnLineId !== options.excludeReturnLineId
        )
        .reduce((total, claim) => total + claim.quantity, 0)

      return {
        lineItemId,
        ceiling,
        alreadyReturned,
        remaining: ceiling === null ? null : Math.max(0, ceiling - alreadyReturned),
        ceilingSource,
      }
    },
    'Failed to read returnable quantity',
    { organizationId, lineItemId }
  )
}

/**
 * The ceiling of every named line, without the claims.
 *
 * Two queries for any number of lines: the dispatch sum, then the sold
 * quantities of whatever the first left unanswered. A caller that already holds
 * `line_item_qty` for these lines passes it as `soldQuantities` and pays one.
 *
 * Split from the claims because `checkOverReturn` takes the ceiling and the
 * claim list as two separate inputs - it derives neither - and the write path
 * would otherwise run the claims query twice.
 */
export async function readReturnCeilings(
  db: ReturnsReadDb,
  organizationId: string,
  lineItemIds: readonly string[],
  options: { soldQuantities?: Map<string, number | null> } = {}
): Promise<Map<string, ReturnCeiling>> {
  const ceilings = new Map<string, ReturnCeiling>()
  const ids = [...new Set(lineItemIds)]
  if (ids.length === 0) return ceilings

  const shipped = await readShippedQuantities(db, organizationId, ids)
  const unshipped = ids.filter((id) => shipped.get(id) == null)
  const sold =
    options.soldQuantities ??
    (unshipped.length > 0 ? await readSoldQuantities(db, organizationId, unshipped) : new Map())

  for (const id of ids) {
    const shippedQuantity = shipped.get(id)
    if (shippedQuantity != null) {
      ceilings.set(id, { ceiling: shippedQuantity, ceilingSource: 'shipped' })
      continue
    }
    const soldQuantity = sold.get(id)
    if (soldQuantity != null) {
      ceilings.set(id, { ceiling: soldQuantity, ceilingSource: 'sold' })
      continue
    }
    // Neither door answered. The caller decides; the guard passes.
    ceilings.set(id, { ceiling: null, ceilingSource: 'unknown' })
  }
  return ceilings
}

/** {@link readReturnCeilings} for one sold line. */
export async function readReturnCeiling(
  db: ReturnsReadDb,
  organizationId: string,
  lineItemId: string
): Promise<ReturnCeiling> {
  const ceilings = await readReturnCeilings(db, organizationId, [lineItemId])
  return ceilings.get(lineItemId) ?? { ceiling: null, ceilingSource: 'unknown' }
}

/**
 * Σ `fulfillment_line_quantity` per sold line, over dispatches that were not
 * cancelled. A line with no fulfillment lines at all is absent from the map.
 *
 * Absent and zero mean different things here and the caller depends on it:
 * absent is "there is no dispatch data for this line, use the sold quantity",
 * zero is "there are dispatches and none of them shipped this line", which
 * correctly refuses every return against it.
 */
async function readShippedQuantities(
  db: ReturnsReadDb,
  organizationId: string,
  lineItemIds: string[]
): Promise<Map<string, number>> {
  const shipped = new Map<string, number>()
  const fields = await systemFieldMap(db, organizationId, [
    ...pickSystemAttributes(FULFILLMENT_LINE_FIELDS, [
      'fulfillment_line_line_item',
      'fulfillment_line_quantity',
      'fulfillment_line_fulfillment',
    ] as const),
    ...pickSystemAttributes(FULFILLMENT_FIELDS, ['fulfillment_status'] as const),
  ])

  const lineItemField = fields.fulfillment_line_line_item
  const quantityField = fields.fulfillment_line_quantity
  if (!lineItemField || !quantityField) return shipped

  const lineItemValue = alias(schema.FieldValue, 'fl_line_item_v')
  const quantityValue = alias(schema.FieldValue, 'fl_quantity_v')
  const fulfillmentValue = alias(schema.FieldValue, 'fl_fulfillment_v')
  const statusValue = alias(schema.FieldValue, 'f_status_v')

  // A cancelled dispatch is a RECORD carrying that status, never an absence, so
  // the exclusion reads the fulfillment's own status rather than assuming a
  // vanished row. Without both fields provisioned the join cannot be made and
  // every dispatch counts, which is the looser of the two answers and matches
  // what the organization can actually see.
  const fulfillmentField = fields.fulfillment_line_fulfillment
  const statusField = fields.fulfillment_status
  const canExcludeCancelled = fulfillmentField != null && statusField != null

  let query = db
    .select({ lineItemId: lineItemValue.relatedEntityId, quantity: quantityValue.valueNumber })
    .from(schema.EntityInstance)
    .innerJoin(
      lineItemValue,
      and(
        systemValueJoin(lineItemValue, lineItemField.id),
        inArray(lineItemValue.relatedEntityId, lineItemIds)
      )
    )
    .leftJoin(quantityValue, systemValueJoin(quantityValue, quantityField.id))
    .$dynamic()

  if (fulfillmentField && statusField) {
    query = query
      .leftJoin(fulfillmentValue, systemValueJoin(fulfillmentValue, fulfillmentField.id))
      .leftJoin(
        statusValue,
        and(
          eq(statusValue.entityId, fulfillmentValue.relatedEntityId),
          eq(statusValue.organizationId, fulfillmentValue.organizationId),
          eq(statusValue.fieldId, statusField.id)
        )
      )
  }

  const rows = await query.where(
    and(
      eq(schema.EntityInstance.organizationId, organizationId),
      isNull(schema.EntityInstance.archivedAt),
      ...(canExcludeCancelled ? [sql`coalesce(${statusValue.optionId}, '') <> 'cancelled'`] : [])
    )
  )

  for (const row of rows) {
    if (!row.lineItemId) continue
    shipped.set(row.lineItemId, (shipped.get(row.lineItemId) ?? 0) + (row.quantity ?? 0))
  }
  return shipped
}

/**
 * `line_item_qty` per line - the documented fallback ceiling - or an empty map
 * when the org has no such field.
 *
 * 🛑 Absent and zero are different answers and must not be collapsed. Zero is a
 * ceiling that refuses every unit; absent means nobody has said what the
 * ceiling is. A line that records no quantity reads as zero, exactly as it did
 * before: only a missing FIELD yields the unknown answer.
 */
async function readSoldQuantities(
  db: ReturnsReadDb,
  organizationId: string,
  lineItemIds: string[]
): Promise<Map<string, number>> {
  const sold = new Map<string, number>()
  const ctx = await systemFields(
    db,
    organizationId,
    'line_item',
    pickSystemAttributes(LINE_ITEM_FIELDS, ['line_item_qty'] as const)
  )
  if (!ctx?.fields.line_item_qty) return sold

  // `includeArchived`: the ceiling of a line that was archived after it shipped
  // is still the number that shipped, and the guard must not silently widen.
  const records = await readSystemRecords(db, organizationId, ctx, {
    ids: lineItemIds,
    includeArchived: true,
  })
  for (const id of lineItemIds) sold.set(id, 0)
  for (const record of records) sold.set(record.id, record.number('line_item_qty') ?? 0)
  return sold
}

// ─── internals ──────────────────────────────────────────────────────

/** The status set a filter combination narrows to, or undefined for "any". */
function resolveStatusFilter(filters: ListReturnsFilters): readonly ReturnStatus[] | undefined {
  if (!filters.creditedNotInspected) return filters.status
  if (!filters.status) return PRE_INSPECTION_RETURN_STATUSES
  return filters.status.filter((status) => PRE_INSPECTION_RETURN_STATUSES.includes(status))
}

/** The `credit_memo` attributes the return surfaces read. */
const CREDIT_MEMO_PICK = pickSystemAttributes(CREDIT_MEMO_FIELDS, [
  'credit_memo_order',
  'credit_memo_return',
  'credit_memo_number',
  'credit_memo_total',
  'credit_memo_status',
  'credit_memo_issued_at',
] as const)

/**
 * Credit memos on this return's order that no return has claimed yet, newest
 * first (plans/money/tasks/54-returns.md section 5.1).
 *
 * 🔑 The link between a return and its money is never made automatically, and
 * this is the whole of the help the brief asks for. On the channel path the
 * connector creates the memo FIRST - the refund is issued in Shopify, synced,
 * and settled the instant it lands - so by the time somebody records the return
 * the memo is already sitting there unclaimed. Offering exactly that set turns
 * a picker over every memo in the org into a list of two.
 *
 * 🛑 Reads only. Linking is the picker's job and it writes `credit_memo.return`
 * on the MEMO, because the FK lives there: a memo very often has no return at
 * all (an allowance, a cancellation), and a return can produce several.
 *
 * ⚠️ Never write to a channel-sourced memo beyond that one link. Its fields are
 * connector-managed and the sync re-delivers every refund on every order sync.
 *
 * Returns an empty list rather than refusing when the org has no
 * `credit_memo.return` field yet, or when the return names no order - both are
 * "nothing to suggest", not failures.
 */
export async function readUnlinkedCreditMemosForOrder(
  db: Database,
  organizationId: string,
  orderId: string
): Promise<Result<UnlinkedCreditMemo[], Error>> {
  return guard(async () => {
    const ctx = await systemFields(db, organizationId, 'credit_memo', CREDIT_MEMO_PICK)
    const orderField = ctx?.fields.credit_memo_order
    const returnField = ctx?.fields.credit_memo_return
    if (!ctx || !orderField || !returnField) return []

    const orderValue = alias(schema.FieldValue, 'cm_order_v')
    const returnValue = alias(schema.FieldValue, 'cm_ret_v')

    const rows = await db
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .innerJoin(orderValue, systemValueJoin(orderValue, orderField.id))
      // A LEFT JOIN plus IS NULL, not a NOT EXISTS: the row is one-to-one
      // with the memo, so it cannot multiply the page, and "unclaimed" is
      // exactly the absence of this value.
      .leftJoin(returnValue, systemValueJoin(returnValue, returnField.id))
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          isNull(schema.EntityInstance.archivedAt),
          eq(orderValue.relatedEntityId, orderId),
          isNull(returnValue.relatedEntityId)
        )
      )
      .orderBy(desc(schema.EntityInstance.createdAt))

    if (rows.length === 0) return []
    const page = rows.map((row) => row.id)
    const records = await readSystemRecords(db, organizationId, ctx, { ids: page })

    return inPageOrder(records, page).map((record) => ({
      creditMemoId: record.id,
      number: record.text('credit_memo_number'),
      total: record.number('credit_memo_total'),
      status: record.option('credit_memo_status'),
      // `valueDate` is a text column; every other date this module returns is
      // a `Date`, so convert here rather than leaking the raw string.
      issuedAt: toDate(record.date('credit_memo_issued_at')),
    }))
  }, 'readUnlinkedCreditMemosForOrder')
}

/** `credit_memo.return`'s field id, or null when the org has no such field. */
async function loadCreditMemoReturnFieldId(
  db: Database,
  organizationId: string
): Promise<string | null> {
  const fields = await systemFieldMap(
    db,
    organizationId,
    pickSystemAttributes(CREDIT_MEMO_FIELDS, ['credit_memo_return'] as const)
  )
  return fields.credit_memo_return?.id ?? null
}

/**
 * "At least one unarchived credit memo names this return."
 *
 * A correlated `EXISTS` rather than a join: a return with three memos must
 * appear once, and a join would multiply the page.
 */
function linkedCreditMemoExists(db: Database, organizationId: string, memoFieldId: string): SQL {
  const memoValue = alias(schema.FieldValue, 'cm_return_v')
  const memoInstance = alias(schema.EntityInstance, 'cm_instance')
  return exists(
    db
      .select({ one: sql`1` })
      .from(memoValue)
      .innerJoin(
        memoInstance,
        and(
          eq(memoInstance.id, memoValue.entityId),
          eq(memoInstance.organizationId, organizationId),
          isNull(memoInstance.archivedAt)
        )
      )
      .where(
        and(
          eq(memoValue.organizationId, organizationId),
          eq(memoValue.fieldId, memoFieldId),
          eq(memoValue.relatedEntityId, schema.EntityInstance.id)
        )
      )
  )
}

/** `EntityInstance.createdAt` is NOT NULL in the schema; the reader types it defensively. */
function createdAtOf(record: { createdAt: Date | null }): Date {
  return record.createdAt ?? new Date(0)
}

function toDate(iso: string | null): Date | null {
  return iso ? new Date(iso) : null
}

async function hydrateReturns(
  db: Database,
  organizationId: string,
  ctx: ReturnFieldContext,
  records: SystemRecord<ReturnAttribute>[]
): Promise<ReturnRecord[]> {
  if (records.length === 0) return []
  const memos = await readLinkedCreditMemoIds(
    db,
    organizationId,
    records.map((record) => record.id)
  )

  return records.map((record) => {
    const status = toReturnStatus(record.option('return_status'))
    const contactId = record.related('return_contact')
    const creditMemoIds = memos.get(record.id) ?? []

    return {
      returnId: record.id,
      recordId: toRecordId(ctx.defId, record.id),
      number: record.text('return_number'),
      status,
      origin: (record.option('return_origin') as ReturnOrigin | null) ?? null,
      reasons: record
        .cells('return_reason')
        .map((value) => (value.type === 'option' ? value.optionId : null))
        .filter((optionId): optionId is string => optionId != null),
      customerNote: record.text('return_customer_note'),
      contactId,
      orderId: record.related('return_order'),
      ticketId: record.related('return_ticket'),
      requestedAt: toDate(record.date('return_requested_at')),
      receivedAt: toDate(record.date('return_received_at')),
      inspectedAt: toDate(record.date('return_inspected_at')),
      closedAt: toDate(record.date('return_closed_at')),
      senderNameRaw: record.text('return_sender_name_raw'),
      senderAddressRaw: record.text('return_sender_address_raw'),
      inboundCarrier: record.text('return_inbound_carrier'),
      // 🛑 `cells`, never `cell`. This field went multi-value in entity
      // migration 155 and `cell()` takes the FIRST value — a return covering
      // three parcels would have reported one tracking number with nothing
      // anywhere saying the other two existed.
      inboundTracking: record
        .cells('return_inbound_tracking')
        .map((value) => (value.type === 'text' ? value.value : null))
        .filter((text): text is string => text != null && text !== ''),
      labelProvided: record.boolean('return_label_provided'),
      labelCost: record.number('return_label_cost'),
      goodsValue: record.number('return_goods_value'),
      creditedAmount: record.number('return_credited_amount'),
      withheldAmount: record.number('return_withheld_amount'),
      withheldReason: record.text('return_withheld_reason'),
      creditMemoIds,
      unidentified: contactId === null,
      // Both halves derived, neither stored: memos present AND the goods not
      // yet looked at. A status nobody recognises is not reported as at risk.
      creditedNotInspected:
        creditMemoIds.length > 0 &&
        status !== null &&
        PRE_INSPECTION_RETURN_STATUSES.includes(status),
      createdAt: createdAtOf(record),
    }
  })
}

/** `returnId -> the unarchived credit memos naming it`. */
async function readLinkedCreditMemoIds(
  db: Database,
  organizationId: string,
  returnIds: string[]
): Promise<Map<string, string[]>> {
  const byReturn = new Map<string, string[]>()
  if (returnIds.length === 0) return byReturn

  const ctx = await systemFields(
    db,
    organizationId,
    'credit_memo',
    pickSystemAttributes(CREDIT_MEMO_FIELDS, ['credit_memo_return'] as const)
  )
  if (!ctx?.fields.credit_memo_return) return byReturn

  const memos = await readSystemRecords(db, organizationId, ctx, {
    by: { attribute: 'credit_memo_return', in: returnIds },
  })
  for (const memo of memos) {
    const returnId = memo.related('credit_memo_return')
    if (!returnId) continue
    const bucket = byReturn.get(returnId) ?? []
    bucket.push(memo.id)
    byReturn.set(returnId, bucket)
  }
  return byReturn
}

function toReturnLineRecord(
  ctx: ReturnLineFieldContext,
  record: SystemRecord<ReturnLineAttribute>
): ReturnLineRecord {
  return {
    returnLineId: record.id,
    recordId: toRecordId(ctx.defId, record.id),
    returnId: record.related('return_line_return'),
    lineItemId: record.related('return_line_line_item'),
    partId: record.related('return_line_part'),
    quantity: record.number('return_line_quantity'),
    conditionGrade:
      (record.option('return_line_condition_grade') as ReturnLineConditionGrade | null) ?? null,
    liability: (record.option('return_line_liability') as ReturnLineLiability | null) ?? null,
    inspectionNotes: record.text('return_line_inspection_notes'),
    inspectedByUserId: record.actor('return_line_inspected_by'),
    inspectedAt: toDate(record.date('return_line_inspected_at')),
    createdAt: createdAtOf(record),
  }
}

function toReturnPartLineRecord(
  ctx: ReturnPartLineFieldContext,
  record: SystemRecord<ReturnPartLineAttribute>
): ReturnPartLineRecord {
  return {
    id: record.id,
    recordId: toRecordId(ctx.defId, record.id),
    returnLineId: record.related('return_part_line_return_line'),
    parentId: record.related('return_part_line_parent'),
    partId: record.related('return_part_line_part') ?? '',
    quantity: record.number('return_part_line_quantity') ?? 0,
    // `undecided` by absence is the documented default, and a row whose
    // status somehow went missing reads the same way rather than as `good`.
    status: (record.option('return_part_line_status') as SalvageStatus | null) ?? 'undecided',
    salvagePercent: record.number('return_part_line_salvage_percent') ?? 100,
    sortOrder: record.text('return_part_line_sort_order'),
    unitCost: record.number('return_part_line_unit_cost'),
    movementId: record.related('return_part_line_movement'),
    createdAt: createdAtOf(record),
  }
}
