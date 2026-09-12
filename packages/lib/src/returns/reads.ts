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
 * Reads only. The writes are in `writes.ts`, because a file that both queries
 * and mutates is the first step back toward a service class
 * (`docs/lib-module-guide.md` section 5). No permission checks: the router
 * asserts (section 6).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, asc, desc, eq, exists, inArray, isNotNull, isNull, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../cache'
import { NotFoundError } from '../errors'
import { type RecordId, toRecordId } from '../resources/resource-id'
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
} from './field-context'
import { guard } from './guard'
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
  inboundTracking: string | null
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
      const ctx = await loadReturnFieldContext(organizationId)
      if (!ctx) return []

      const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
      const offset = filters.offset ?? 0
      const where: SQL[] = [
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.returnDefId),
        isNull(schema.EntityInstance.archivedAt),
      ]

      let query = db
        .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
        .from(schema.EntityInstance)
        .$dynamic()

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
            valueJoin(statusValue, ctx.fields.return_status.id),
            inArray(statusValue.optionId, [...statuses])
          )
        )
      }

      if (filters.unidentified !== undefined && ctx.fields.return_contact) {
        const contactValue = alias(schema.FieldValue, 'return_unidentified_v')
        query = query.leftJoin(contactValue, valueJoin(contactValue, ctx.fields.return_contact.id))
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
          and(valueJoin(related, field.id), eq(related.relatedEntityId, value))
        )
      }

      if (filters.creditedNotInspected) {
        const memoFieldId = await loadCreditMemoReturnFieldId(organizationId)
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
      return hydrateReturns(db, organizationId, ctx, rows)
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
      const ctx = await loadReturnFieldContext(organizationId)
      if (!ctx) return null

      const [instance] = await db
        .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.id, returnId),
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, ctx.returnDefId),
            isNull(schema.EntityInstance.archivedAt)
          )
        )
        .limit(1)
      if (!instance) return null

      const [record] = await hydrateReturns(db, organizationId, ctx, [instance])
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
  const ctx = await loadReturnLineFieldContext(organizationId)
  if (!ctx) return []

  const returnValue = alias(schema.FieldValue, 'return_line_return_v')
  const rows = await db
    .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
    .from(schema.EntityInstance)
    .innerJoin(
      returnValue,
      and(
        valueJoin(returnValue, ctx.fields.return_line_return?.id ?? ''),
        eq(returnValue.relatedEntityId, returnId)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.returnLineDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .orderBy(asc(schema.EntityInstance.createdAt))

  if (rows.length === 0) return []
  return hydrateReturnLines(db, organizationId, ctx, rows)
}

/** One return line, or null. */
export async function readReturnLine(
  db: Database,
  organizationId: string,
  returnLineId: string
): Promise<ReturnLineRecord | null> {
  const ctx = await loadReturnLineFieldContext(organizationId)
  if (!ctx) return null

  const [instance] = await db
    .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, returnLineId),
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.returnLineDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)
  if (!instance) return null

  const [record] = await hydrateReturnLines(db, organizationId, ctx, [instance])
  return record ?? null
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
 * The whole checklist in one query, which is why `return_part_line_return_line`
 * is carried on every row in the tree rather than only on the roots.
 */
export async function readReturnPartLines(
  db: Database,
  organizationId: string,
  returnLineId: string
): Promise<ReturnPartLineRecord[]> {
  const ctx = await loadReturnPartLineFieldContext(organizationId)
  if (!ctx) return []

  const lineValue = alias(schema.FieldValue, 'return_part_line_line_v')
  const rows = await db
    .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
    .from(schema.EntityInstance)
    .innerJoin(
      lineValue,
      and(
        valueJoin(lineValue, ctx.fields.return_part_line_return_line?.id ?? ''),
        eq(lineValue.relatedEntityId, returnLineId)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.returnPartLineDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .orderBy(asc(schema.EntityInstance.createdAt))

  if (rows.length === 0) return []
  return hydrateReturnPartLines(db, organizationId, ctx, rows)
}

/** One materialized part line, or null. Used by the write paths to re-read a row. */
export async function readReturnPartLine(
  db: Database,
  organizationId: string,
  partLineId: string
): Promise<ReturnPartLineRecord | null> {
  const ctx = await loadReturnPartLineFieldContext(organizationId)
  if (!ctx) return null

  const [instance] = await db
    .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, partLineId),
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.returnPartLineDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .limit(1)
  if (!instance) return null

  const [record] = await hydrateReturnPartLines(db, organizationId, ctx, [instance])
  return record ?? null
}

// ─── The over-return guard's two inputs ─────────────────────────────

/** What {@link readReturnableQuantity} answers, for the create dialog and the guard. */
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

/**
 * Every `return_line` already pointing at one `line_item`, across ALL returns.
 *
 * The grain is one row per sold line PER CONDITION, so several rows routinely
 * point at one line item and a per-row check is useless. This is the set
 * `checkOverReturn` sums.
 */
export async function readReturnedQuantityClaims(
  db: ReturnsReadDb,
  organizationId: string,
  lineItemId: string
): Promise<{ returnLineId: string; quantity: number }[]> {
  const ctx = await loadReturnLineFieldContext(organizationId)
  const lineItemField = ctx?.fields.return_line_line_item
  const quantityField = ctx?.fields.return_line_quantity
  if (!ctx || !lineItemField || !quantityField) return []

  const lineItemValue = alias(schema.FieldValue, 'rl_line_item_v')
  const quantityValue = alias(schema.FieldValue, 'rl_quantity_v')

  const rows = await db
    .select({ id: schema.EntityInstance.id, quantity: quantityValue.valueNumber })
    .from(schema.EntityInstance)
    .innerJoin(
      lineItemValue,
      and(valueJoin(lineItemValue, lineItemField.id), eq(lineItemValue.relatedEntityId, lineItemId))
    )
    .leftJoin(quantityValue, valueJoin(quantityValue, quantityField.id))
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.returnLineDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  return rows.map((row) => ({ returnLineId: row.id, quantity: row.quantity ?? 0 }))
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
 * The ceiling alone, without the claims.
 *
 * Split out because `checkOverReturn` takes the ceiling and the claim list as
 * two separate inputs - it derives neither - and the write path would otherwise
 * run the claims query twice.
 */
export async function readReturnCeiling(
  db: ReturnsReadDb,
  organizationId: string,
  lineItemId: string
): Promise<{ ceiling: number | null; ceilingSource: 'shipped' | 'sold' | 'unknown' }> {
  const shipped = await readShippedQuantity(db, organizationId, lineItemId)
  if (shipped !== null) return { ceiling: shipped, ceilingSource: 'shipped' }
  const sold = await readSoldQuantity(db, organizationId, lineItemId)
  if (sold !== null) return { ceiling: sold, ceilingSource: 'sold' }
  // Neither door answered. The caller decides; the guard passes.
  return { ceiling: null, ceilingSource: 'unknown' }
}

/**
 * Σ `fulfillment_line_quantity` for one sold line, over dispatches that were
 * not cancelled, or null when the line has no fulfillment lines at all.
 *
 * Null and zero mean different things here and the caller depends on it: null
 * is "there is no dispatch data for this line, use the sold quantity", zero is
 * "there are dispatches and none of them shipped this line", which correctly
 * refuses every return against it.
 */
async function readShippedQuantity(
  db: ReturnsReadDb,
  organizationId: string,
  lineItemId: string
): Promise<number | null> {
  const cache = getOrgCache()
  const fields = await cache
    .from(organizationId, 'customFields')
    .bySystemAttributes([
      'fulfillment_line_line_item',
      'fulfillment_line_quantity',
      'fulfillment_line_fulfillment',
      'fulfillment_status',
    ] as const)

  const lineItemField = fields.fulfillment_line_line_item
  const quantityField = fields.fulfillment_line_quantity
  if (!lineItemField || !quantityField) return null

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
    .select({ id: schema.EntityInstance.id, quantity: quantityValue.valueNumber })
    .from(schema.EntityInstance)
    .innerJoin(
      lineItemValue,
      and(valueJoin(lineItemValue, lineItemField.id), eq(lineItemValue.relatedEntityId, lineItemId))
    )
    .leftJoin(quantityValue, valueJoin(quantityValue, quantityField.id))
    .$dynamic()

  if (fulfillmentField && statusField) {
    query = query
      .leftJoin(fulfillmentValue, valueJoin(fulfillmentValue, fulfillmentField.id))
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

  if (rows.length === 0) return null
  return rows.reduce((total, row) => total + (row.quantity ?? 0), 0)
}

/**
 * `line_item_qty` - the documented fallback ceiling, or **null when the line
 * records no quantity at all**.
 *
 * 🛑 Null and zero are different answers and must not be collapsed. Zero is a
 * ceiling that refuses every unit; null means nobody has said what the ceiling
 * is. Returning `0` for the unknown case silently turns the over-return guard
 * into a wall that blocks every return against any line whose quantity was
 * never recorded - a refusal built out of missing data rather than out of a
 * real breach.
 */
async function readSoldQuantity(
  db: ReturnsReadDb,
  organizationId: string,
  lineItemId: string
): Promise<number | null> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['line_item_qty'] as const)
  const qtyField = fields.line_item_qty
  if (!qtyField) return null

  const [row] = await db
    .select({ quantity: schema.FieldValue.valueNumber })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, lineItemId),
        eq(schema.FieldValue.fieldId, qtyField.id)
      )
    )
    .limit(1)

  return row?.quantity ?? 0
}

// ─── internals ──────────────────────────────────────────────────────

/** The status set a filter combination narrows to, or undefined for "any". */
function resolveStatusFilter(filters: ListReturnsFilters): readonly ReturnStatus[] | undefined {
  if (!filters.creditedNotInspected) return filters.status
  if (!filters.status) return PRE_INSPECTION_RETURN_STATUSES
  return filters.status.filter((status) => PRE_INSPECTION_RETURN_STATUSES.includes(status))
}

/** An aliased `FieldValue` table, as `alias()` returns it. */
type FieldValueAlias = ReturnType<typeof alias<typeof schema.FieldValue, string>>

/**
 * Join predicate for "this instance's value of <field>".
 *
 * Takes the alias OBJECT and composes with `eq`, so drizzle emits the table as
 * an identifier. A hand-written `sql` fragment interpolating a table binds it
 * as a parameter instead, which is a mistake this codebase has already paid
 * for.
 */
function valueJoin(table: FieldValueAlias, fieldId: string): SQL | undefined {
  return and(
    eq(table.entityId, schema.EntityInstance.id),
    eq(table.organizationId, schema.EntityInstance.organizationId),
    eq(table.fieldId, fieldId)
  )
}

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
    const fields = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes([
        'credit_memo_order',
        'credit_memo_return',
        'credit_memo_number',
        'credit_memo_total',
        'credit_memo_status',
        'credit_memo_issued_at',
      ] as const)

    const orderField = fields.credit_memo_order
    const returnField = fields.credit_memo_return
    if (!orderField || !returnField) return []

    const orderValue = alias(schema.FieldValue, 'cm_order_v')
    const returnValue = alias(schema.FieldValue, 'cm_ret_v')
    const numberValue = alias(schema.FieldValue, 'cm_num_v')
    const totalValue = alias(schema.FieldValue, 'cm_total_v')
    const statusValue = alias(schema.FieldValue, 'cm_status_v')
    const issuedValue = alias(schema.FieldValue, 'cm_issued_v')

    const rows = await db
      .select({
        id: schema.EntityInstance.id,
        number: numberValue.valueText,
        total: totalValue.valueNumber,
        status: statusValue.optionId,
        issuedAt: issuedValue.valueDate,
        createdAt: schema.EntityInstance.createdAt,
      })
      .from(schema.EntityInstance)
      .innerJoin(orderValue, valueJoin(orderValue, orderField.id))
      // A LEFT JOIN plus IS NULL, not a NOT EXISTS: the row is one-to-one
      // with the memo, so it cannot multiply the page, and "unclaimed" is
      // exactly the absence of this value.
      .leftJoin(returnValue, valueJoin(returnValue, returnField.id))
      .leftJoin(numberValue, valueJoin(numberValue, fields.credit_memo_number?.id ?? ''))
      .leftJoin(totalValue, valueJoin(totalValue, fields.credit_memo_total?.id ?? ''))
      .leftJoin(statusValue, valueJoin(statusValue, fields.credit_memo_status?.id ?? ''))
      .leftJoin(issuedValue, valueJoin(issuedValue, fields.credit_memo_issued_at?.id ?? ''))
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          isNull(schema.EntityInstance.archivedAt),
          eq(orderValue.relatedEntityId, orderId),
          isNull(returnValue.relatedEntityId)
        )
      )
      .orderBy(desc(schema.EntityInstance.createdAt))

    return rows.map((row) => ({
      creditMemoId: row.id,
      number: row.number,
      total: row.total,
      status: row.status,
      // `valueDate` is a text column; every other date this module returns is
      // a `Date`, so convert here rather than leaking the raw string.
      issuedAt: row.issuedAt ? new Date(row.issuedAt) : null,
    }))
  }, 'readUnlinkedCreditMemosForOrder')
}

/** `credit_memo.return`'s field id, or null when the org has no such field. */
async function loadCreditMemoReturnFieldId(organizationId: string): Promise<string | null> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes(['credit_memo_return'] as const)
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

/** One `FieldValue` row, narrowed to the columns this module reads. */
interface ValueRow {
  valueText: string | null
  valueNumber: number | null
  valueDate: string | null
  valueBoolean: boolean | null
  optionId: string | null
  relatedEntityId: string | null
  actorId: string | null
}

/** `entityId -> fieldId -> every row`, because TAGS is multi-row. */
type ValueIndex = Map<string, Map<string, ValueRow[]>>

/**
 * Turn a page of instance ids into their field values with ONE query.
 *
 * The alternative - a join per attribute on the paging query - multiplies the
 * row count and makes `LIMIT` mean something other than "this many returns".
 */
async function readValues(
  db: Database,
  organizationId: string,
  entityIds: string[],
  fieldIds: string[]
): Promise<ValueIndex> {
  const index: ValueIndex = new Map()
  if (entityIds.length === 0 || fieldIds.length === 0) return index

  const values = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      valueDate: schema.FieldValue.valueDate,
      valueBoolean: schema.FieldValue.valueBoolean,
      optionId: schema.FieldValue.optionId,
      relatedEntityId: schema.FieldValue.relatedEntityId,
      actorId: schema.FieldValue.actorId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, entityIds),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  for (const value of values) {
    let byField = index.get(value.entityId)
    if (!byField) {
      byField = new Map()
      index.set(value.entityId, byField)
    }
    const bucket = byField.get(value.fieldId) ?? []
    bucket.push(value)
    byField.set(value.fieldId, bucket)
  }
  return index
}

/** Every provisioned field id in a context, for {@link readValues}. */
function fieldIdsOf(fields: Record<string, { id: string } | null>): string[] {
  return Object.values(fields)
    .filter((field): field is { id: string } => field != null)
    .map((field) => field.id)
}

/** A reader bound to one instance's values, so the mapping below stays flat. */
function valueReader<A extends string>(
  fields: Record<A, { id: string } | null>,
  byField: Map<string, ValueRow[]> | undefined
) {
  const all = (attribute: A): ValueRow[] => {
    const id = fields[attribute]?.id
    return id ? (byField?.get(id) ?? []) : []
  }
  const one = (attribute: A): ValueRow | null => all(attribute)[0] ?? null
  const date = (attribute: A): Date | null => {
    const raw = one(attribute)?.valueDate
    return raw ? new Date(raw) : null
  }
  return { all, one, date }
}

async function hydrateReturns(
  db: Database,
  organizationId: string,
  ctx: ReturnFieldContext,
  page: { id: string; createdAt: Date }[]
): Promise<ReturnRecord[]> {
  const ids = page.map((row) => row.id)
  const index = await readValues(db, organizationId, ids, fieldIdsOf(ctx.fields))
  const memos = await readLinkedCreditMemoIds(db, organizationId, ids)

  return page.map((row) => {
    const read = valueReader<ReturnAttribute>(ctx.fields, index.get(row.id))
    const status = toReturnStatus(read.one('return_status')?.optionId)
    const contactId = read.one('return_contact')?.relatedEntityId ?? null
    const creditMemoIds = memos.get(row.id) ?? []

    return {
      returnId: row.id,
      recordId: toRecordId(ctx.returnDefId, row.id),
      number: read.one('return_number')?.valueText ?? null,
      status,
      origin: (read.one('return_origin')?.optionId as ReturnOrigin | undefined) ?? null,
      reasons: read
        .all('return_reason')
        .map((value) => value.optionId)
        .filter((optionId): optionId is string => optionId != null),
      customerNote: read.one('return_customer_note')?.valueText ?? null,
      contactId,
      orderId: read.one('return_order')?.relatedEntityId ?? null,
      ticketId: read.one('return_ticket')?.relatedEntityId ?? null,
      requestedAt: read.date('return_requested_at'),
      receivedAt: read.date('return_received_at'),
      inspectedAt: read.date('return_inspected_at'),
      closedAt: read.date('return_closed_at'),
      senderNameRaw: read.one('return_sender_name_raw')?.valueText ?? null,
      senderAddressRaw: read.one('return_sender_address_raw')?.valueText ?? null,
      inboundCarrier: read.one('return_inbound_carrier')?.valueText ?? null,
      inboundTracking: read.one('return_inbound_tracking')?.valueText ?? null,
      labelProvided: read.one('return_label_provided')?.valueBoolean ?? null,
      labelCost: read.one('return_label_cost')?.valueNumber ?? null,
      goodsValue: read.one('return_goods_value')?.valueNumber ?? null,
      creditedAmount: read.one('return_credited_amount')?.valueNumber ?? null,
      withheldAmount: read.one('return_withheld_amount')?.valueNumber ?? null,
      withheldReason: read.one('return_withheld_reason')?.valueText ?? null,
      creditMemoIds,
      unidentified: contactId === null,
      // Both halves derived, neither stored: memos present AND the goods not
      // yet looked at. A status nobody recognises is not reported as at risk.
      creditedNotInspected:
        creditMemoIds.length > 0 &&
        status !== null &&
        PRE_INSPECTION_RETURN_STATUSES.includes(status),
      createdAt: row.createdAt,
    }
  })
}

/** `returnId -> the unarchived credit memos naming it`. One query for the page. */
async function readLinkedCreditMemoIds(
  db: Database,
  organizationId: string,
  returnIds: string[]
): Promise<Map<string, string[]>> {
  const byReturn = new Map<string, string[]>()
  const memoFieldId = await loadCreditMemoReturnFieldId(organizationId)
  if (!memoFieldId || returnIds.length === 0) return byReturn

  const rows = await db
    .select({
      memoId: schema.FieldValue.entityId,
      returnId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.FieldValue.entityId),
        eq(schema.EntityInstance.organizationId, organizationId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, memoFieldId),
        inArray(schema.FieldValue.relatedEntityId, returnIds)
      )
    )

  for (const row of rows) {
    if (!row.returnId) continue
    const bucket = byReturn.get(row.returnId) ?? []
    bucket.push(row.memoId)
    byReturn.set(row.returnId, bucket)
  }
  return byReturn
}

async function hydrateReturnLines(
  db: Database,
  organizationId: string,
  ctx: ReturnLineFieldContext,
  page: { id: string; createdAt: Date }[]
): Promise<ReturnLineRecord[]> {
  const index = await readValues(
    db,
    organizationId,
    page.map((row) => row.id),
    fieldIdsOf(ctx.fields)
  )

  return page.map((row) => {
    const read = valueReader<ReturnLineAttribute>(ctx.fields, index.get(row.id))
    return {
      returnLineId: row.id,
      recordId: toRecordId(ctx.returnLineDefId, row.id),
      returnId: read.one('return_line_return')?.relatedEntityId ?? null,
      lineItemId: read.one('return_line_line_item')?.relatedEntityId ?? null,
      partId: read.one('return_line_part')?.relatedEntityId ?? null,
      quantity: read.one('return_line_quantity')?.valueNumber ?? null,
      conditionGrade:
        (read.one('return_line_condition_grade')?.optionId as
          | ReturnLineConditionGrade
          | undefined) ?? null,
      liability:
        (read.one('return_line_liability')?.optionId as ReturnLineLiability | undefined) ?? null,
      inspectionNotes: read.one('return_line_inspection_notes')?.valueText ?? null,
      inspectedByUserId: read.one('return_line_inspected_by')?.actorId ?? null,
      inspectedAt: read.date('return_line_inspected_at'),
      createdAt: row.createdAt,
    }
  })
}

async function hydrateReturnPartLines(
  db: Database,
  organizationId: string,
  ctx: ReturnPartLineFieldContext,
  page: { id: string; createdAt: Date }[]
): Promise<ReturnPartLineRecord[]> {
  const index = await readValues(
    db,
    organizationId,
    page.map((row) => row.id),
    fieldIdsOf(ctx.fields)
  )

  return page.map((row) => {
    const read = valueReader<ReturnPartLineAttribute>(ctx.fields, index.get(row.id))
    return {
      id: row.id,
      recordId: toRecordId(ctx.returnPartLineDefId, row.id),
      returnLineId: read.one('return_part_line_return_line')?.relatedEntityId ?? null,
      parentId: read.one('return_part_line_parent')?.relatedEntityId ?? null,
      partId: read.one('return_part_line_part')?.relatedEntityId ?? '',
      quantity: read.one('return_part_line_quantity')?.valueNumber ?? 0,
      // `undecided` by absence is the documented default, and a row whose
      // status somehow went missing reads the same way rather than as `good`.
      status:
        (read.one('return_part_line_status')?.optionId as SalvageStatus | undefined) ?? 'undecided',
      salvagePercent: read.one('return_part_line_salvage_percent')?.valueNumber ?? 100,
      sortOrder: read.one('return_part_line_sort_order')?.valueText ?? null,
      unitCost: read.one('return_part_line_unit_cost')?.valueNumber ?? null,
      movementId: read.one('return_part_line_movement')?.relatedEntityId ?? null,
      createdAt: row.createdAt,
    }
  })
}
