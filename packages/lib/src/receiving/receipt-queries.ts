// packages/lib/src/receiving/receipt-queries.ts

/**
 * Reads over the receipt half of the inventory subledger
 * (plans/purchasing/01-build-plan.md section 3.1).
 *
 * Reads only. The writes live in `receive-stock.ts` / `receive-purchase-order.ts`
 * because a file that both queries and mutates is the first step back toward a
 * service class (`docs/lib-module-guide.md` section 5).
 *
 * There are no permission checks here. The router asserts read access on the
 * `stock_movement` def and passes the narrowed filters down; a lib read that
 * decided visibility for itself would have to be kept in step with the router
 * forever (`docs/lib-module-guide.md` section 6).
 */

import { type Database, schema } from '@auxx/database'
import { and, desc, eq, gte, inArray, isNull, lte, type SQL, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import type { ReceiptCostInputs } from './client'
import { guard } from './guard'
import type { ListReceiptsFilters, ReceiptRow } from './types'

/**
 * Every field a receipt row is assembled from.
 *
 * The cost and provenance attributes are only materialised once entity migration
 * 108 has run for the org, so every one of them is treated as optional below —
 * an org mid-migration must read its old movements, not 500.
 */
const RECEIPT_ATTRIBUTES = [
  'stock_movement_type',
  'stock_movement_part',
  'stock_movement_quantity',
  'stock_movement_reference',
  'stock_movement_unit_cost',
  'stock_movement_extended_cost',
  'stock_movement_vendor_unit_price',
  'stock_movement_vendor_part',
  'stock_movement_gl_account',
  'stock_movement_occurred_at',
  'stock_movement_purchase_order_line',
] as const

const DEFAULT_LIMIT = 50

/** An aliased `FieldValue` table, as `alias()` returns it. */
type FieldValueAlias = ReturnType<typeof alias<typeof schema.FieldValue, string>>

/** The resolved ids this module's reads need, or `null` when the org has no ledger yet. */
interface ReceiptFieldContext {
  movementDefId: string
  fields: Record<(typeof RECEIPT_ATTRIBUTES)[number], { id: string } | null>
}

async function loadFieldContext(organizationId: string): Promise<ReceiptFieldContext | null> {
  const movementDefId = await getCachedEntityDefId(organizationId, 'stock_movement')
  if (!movementDefId) return null
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([...RECEIPT_ATTRIBUTES])
  // Without a `type` field there is no way to tell a receipt from a scrap, and a
  // read that guessed would report shipments as purchases.
  if (!fields.stock_movement_type) return null
  return { movementDefId, fields }
}

/**
 * List `receive` movements, newest accounting date first.
 *
 * Ordering is `COALESCE(occurredAt, createdAt)` and not either column alone.
 * `occurredAt` is the truth but is NULL on every movement written before entity
 * migration 108, and those rows are never backfilled (build plan section 2.5) —
 * so ordering on it alone silently sorts the entire pre-migration ledger to one
 * end of the list, and ordering on `createdAt` alone puts a receipt dated last
 * month above one dated last year purely because it was keyed later.
 *
 * Pagination is applied in SQL, in the same statement as the ordering, so a
 * caller asking for page two gets page two of the ordered set rather than page
 * two of an arbitrary set that was then sorted.
 */
export async function listReceipts(
  db: Database,
  organizationId: string,
  filters: ListReceiptsFilters = {}
): Promise<Result<ReceiptRow[], Error>> {
  return guard(
    async () => {
      const ctx = await loadFieldContext(organizationId)
      if (!ctx) return []

      const { movementDefId, fields } = ctx
      const limit = filters.limit ?? DEFAULT_LIMIT
      const offset = filters.offset ?? 0

      const typeValue = alias(schema.FieldValue, 'receipt_type')
      const occurredValue = alias(schema.FieldValue, 'receipt_occurred')

      // The accounting date, with the documented fallback. Built once and used
      // for both the ORDER BY and the since/until window so a row can never be
      // filtered by one date and sorted by another.
      const accountingDate = fields.stock_movement_occurred_at
        ? sql<Date>`COALESCE(${occurredValue.valueDate}, ${schema.EntityInstance.createdAt})`
        : sql<Date>`${schema.EntityInstance.createdAt}`

      const where: SQL[] = [
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, movementDefId),
        isNull(schema.EntityInstance.archivedAt),
        // A SINGLE_SELECT stores its chosen value in `optionId`; for a
        // system-seeded enum that id IS the value ('receive').
        eq(typeValue.optionId, 'receive'),
      ]

      if (filters.since) where.push(gte(accountingDate, filters.since))
      if (filters.until) where.push(lte(accountingDate, filters.until))

      let query = db
        .select({ id: schema.EntityInstance.id, createdAt: schema.EntityInstance.createdAt })
        .from(schema.EntityInstance)
        .innerJoin(
          typeValue,
          and(
            eq(typeValue.entityId, schema.EntityInstance.id),
            eq(typeValue.organizationId, schema.EntityInstance.organizationId),
            eq(typeValue.fieldId, fields.stock_movement_type!.id)
          )
        )
        .$dynamic()

      if (fields.stock_movement_occurred_at) {
        query = query.leftJoin(
          occurredValue,
          and(
            eq(occurredValue.entityId, schema.EntityInstance.id),
            eq(occurredValue.organizationId, schema.EntityInstance.organizationId),
            eq(occurredValue.fieldId, fields.stock_movement_occurred_at.id)
          )
        )
      }

      if (filters.partInstanceId && fields.stock_movement_part) {
        const partValue = alias(schema.FieldValue, 'receipt_part')
        query = query.innerJoin(
          partValue,
          relationJoin(partValue, fields.stock_movement_part.id, filters.partInstanceId)
        )
      }

      if (filters.vendorPartId && fields.stock_movement_vendor_part) {
        const vendorPartValue = alias(schema.FieldValue, 'receipt_vendor_part')
        query = query.innerJoin(
          vendorPartValue,
          relationJoin(vendorPartValue, fields.stock_movement_vendor_part.id, filters.vendorPartId)
        )
      }

      const rows = await query
        .where(and(...where))
        .orderBy(desc(accountingDate), desc(schema.EntityInstance.createdAt))
        .limit(limit)
        .offset(offset)

      if (rows.length === 0) return []
      return hydrateReceipts(db, organizationId, ctx, rows)
    },
    'Failed to list receipts',
    { organizationId, filters }
  )
}

/**
 * Join predicate for "this movement's <relation> points at <instanceId>".
 *
 * Takes the alias OBJECT rather than its name and composes with `eq`, so the
 * table reference is emitted by drizzle as an identifier. A hand-written
 * `sql` fragment interpolating a table would bind it as a parameter instead,
 * which is a mistake this codebase has already paid for once.
 */
function relationJoin(
  table: FieldValueAlias,
  fieldId: string,
  relatedEntityId: string
): SQL | undefined {
  return and(
    eq(table.entityId, schema.EntityInstance.id),
    eq(table.organizationId, schema.EntityInstance.organizationId),
    eq(table.fieldId, fieldId),
    eq(table.relatedEntityId, relatedEntityId)
  )
}

/**
 * Turn a page of movement ids into full rows with ONE additional query.
 *
 * The alternative — a join per attribute on the paging query — multiplies the
 * row count by the number of multi-valued fields and makes `LIMIT` mean
 * something other than "this many movements".
 */
async function hydrateReceipts(
  db: Database,
  organizationId: string,
  ctx: ReceiptFieldContext,
  page: { id: string; createdAt: Date }[]
): Promise<ReceiptRow[]> {
  const { movementDefId, fields } = ctx
  const ids = page.map((row) => row.id)
  const fieldIds = Object.values(fields)
    .filter((field): field is { id: string } => field != null)
    .map((field) => field.id)

  const values = await db
    .select({
      entityId: schema.FieldValue.entityId,
      fieldId: schema.FieldValue.fieldId,
      valueText: schema.FieldValue.valueText,
      valueNumber: schema.FieldValue.valueNumber,
      valueDate: schema.FieldValue.valueDate,
      relatedEntityId: schema.FieldValue.relatedEntityId,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, ids),
        inArray(schema.FieldValue.fieldId, fieldIds)
      )
    )

  const byInstance = new Map<string, Map<string, (typeof values)[number]>>()
  for (const value of values) {
    let bucket = byInstance.get(value.entityId)
    if (!bucket) {
      bucket = new Map()
      byInstance.set(value.entityId, bucket)
    }
    bucket.set(value.fieldId, value)
  }

  const fieldId = (attr: (typeof RECEIPT_ATTRIBUTES)[number]): string | null =>
    fields[attr]?.id ?? null

  return page.map((row) => {
    const bucket = byInstance.get(row.id)
    const read = (attr: (typeof RECEIPT_ATTRIBUTES)[number]) => {
      const id = fieldId(attr)
      return id ? (bucket?.get(id) ?? null) : null
    }
    const occurredRaw = read('stock_movement_occurred_at')?.valueDate ?? null
    return {
      movementId: row.id,
      recordId: `${movementDefId}:${row.id}`,
      partInstanceId: read('stock_movement_part')?.relatedEntityId ?? null,
      quantity: read('stock_movement_quantity')?.valueNumber ?? 0,
      unitCost: read('stock_movement_unit_cost')?.valueNumber ?? null,
      extendedCost: read('stock_movement_extended_cost')?.valueNumber ?? null,
      vendorUnitPrice: read('stock_movement_vendor_unit_price')?.valueNumber ?? null,
      vendorPartId: read('stock_movement_vendor_part')?.relatedEntityId ?? null,
      glAccount: read('stock_movement_gl_account')?.valueText ?? null,
      purchaseOrderLineId: read('stock_movement_purchase_order_line')?.relatedEntityId ?? null,
      reference: read('stock_movement_reference')?.valueText ?? null,
      occurredAt: occurredRaw ? new Date(occurredRaw) : row.createdAt,
      createdAt: row.createdAt,
    }
  })
}

/**
 * Every receipt for one part, newest accounting date first.
 *
 * A thin narrowing of {@link listReceipts} rather than its own query: the
 * inventory tab and the Receive form both want "what did we last pay for this",
 * and two queries answering that question would eventually answer it
 * differently.
 */
export async function getPartReceiptHistory(
  db: Database,
  organizationId: string,
  partInstanceId: string,
  filters: Omit<ListReceiptsFilters, 'partInstanceId'> = {}
): Promise<Result<ReceiptRow[], Error>> {
  return listReceipts(db, organizationId, { ...filters, partInstanceId })
}

/**
 * The unit cost frozen on the most recent priced receipt of a part, or `null`.
 *
 * `null` means "no receipt of this part has ever carried a cost", and callers
 * must treat it as absence rather than as zero — the Receive form prefills from
 * the supplier row when this is null, and `receiveStock` refuses to write at all
 * (build plan section 3.2: never write a receipt at zero cost).
 *
 * Movements with a NULL `unitCost` are skipped rather than ending the search:
 * every pre-migration receipt has one, and stopping at the first would make this
 * return null for every org with any history at all.
 */
export async function getLastReceiptCost(
  db: Database,
  organizationId: string,
  partInstanceId: string
): Promise<Result<number | null, Error>> {
  const receipts = await getPartReceiptHistory(db, organizationId, partInstanceId, { limit: 20 })
  return receipts.map((rows) => rows.find((row) => row.unitCost != null)?.unitCost ?? null)
}

/**
 * The supplier terms that price a receipt, read from one `vendor_part` row.
 *
 * Returns `null` when the row does not exist (or is archived) rather than an
 * empty-priced shape, because the two mean different things to the caller:
 * absent means "you named a supplier row that is not there", while a present row
 * with `unitPrice: null` means "this supplier has terms but no price", and only
 * the second is a legitimate reason to fall back to a typed-in price.
 *
 * Exported because the Receive form prefills from exactly this — the form and
 * the write path must derive the landed cost from the same four numbers or the
 * price shown is not the price frozen.
 */
export async function readVendorPartCostInputs(
  db: Database,
  organizationId: string,
  vendorPartInstanceId: string
): Promise<Result<ReceiptCostInputs | null, Error>> {
  return guard(
    async () => {
      const vendorPartDefId = await getCachedEntityDefId(organizationId, 'vendor_part')
      if (!vendorPartDefId) return null

      const [instance] = await db
        .select({ id: schema.EntityInstance.id })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.id, vendorPartInstanceId),
            eq(schema.EntityInstance.organizationId, organizationId),
            eq(schema.EntityInstance.entityDefinitionId, vendorPartDefId),
            isNull(schema.EntityInstance.archivedAt)
          )
        )
        .limit(1)
      if (!instance) return null

      const fields = await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes([
          'vendor_part_unit_price',
          'vendor_part_shipping_cost',
          'vendor_part_tariff_rate',
          'vendor_part_other_cost',
        ])

      const numbers = await readNumbersByFieldId(db, organizationId, vendorPartInstanceId, [
        fields.vendor_part_unit_price?.id,
        fields.vendor_part_shipping_cost?.id,
        fields.vendor_part_tariff_rate?.id,
        fields.vendor_part_other_cost?.id,
      ])

      return {
        unitPrice: pick(numbers, fields.vendor_part_unit_price?.id),
        shippingCost: pick(numbers, fields.vendor_part_shipping_cost?.id),
        tariffRate: pick(numbers, fields.vendor_part_tariff_rate?.id),
        otherCost: pick(numbers, fields.vendor_part_other_cost?.id),
      }
    },
    'Failed to read vendor part cost inputs',
    { organizationId, vendorPartInstanceId }
  )
}

/**
 * A part's `partKind`, or `null` when it has never been classified.
 *
 * NULL is returned as NULL rather than defaulted here on purpose: this is a
 * read, and the "NULL reads as component" rule is an interpretation that belongs
 * to whoever is interpreting it. {@link import('./client').resolveGlAccountForPartKind}
 * applies it for the GL account; the sale-path explode gate applies the OPPOSITE
 * default to the same NULL (costing plan section 4.3), and a read that had
 * already picked one would make the other impossible to express.
 */
export async function readPartKind(
  db: Database,
  organizationId: string,
  partInstanceId: string
): Promise<Result<string | null, Error>> {
  return guard(
    async () => {
      const fields = await getOrgCache()
        .from(organizationId, 'customFields')
        .bySystemAttributes(['part_kind'])
      const kindField = fields.part_kind
      if (!kindField) return null

      const [row] = await db
        .select({ optionId: schema.FieldValue.optionId })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.entityId, partInstanceId),
            eq(schema.FieldValue.fieldId, kindField.id)
          )
        )
        .limit(1)
      return row?.optionId ?? null
    },
    'Failed to read part kind',
    { organizationId, partInstanceId }
  )
}

/** Read several numeric field values for one instance in a single query. */
async function readNumbersByFieldId(
  db: Database,
  organizationId: string,
  entityId: string,
  fieldIds: (string | undefined)[]
): Promise<Map<string, number | null>> {
  const wanted = fieldIds.filter((id): id is string => Boolean(id))
  if (wanted.length === 0) return new Map()
  const rows = await db
    .select({ fieldId: schema.FieldValue.fieldId, valueNumber: schema.FieldValue.valueNumber })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.entityId, entityId),
        inArray(schema.FieldValue.fieldId, wanted)
      )
    )
  return new Map(rows.map((row) => [row.fieldId, row.valueNumber]))
}

function pick(numbers: Map<string, number | null>, fieldId: string | undefined): number | null {
  return fieldId ? (numbers.get(fieldId) ?? null) : null
}
