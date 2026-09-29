// packages/lib/src/inventory/receiving/receipt-queries.ts

/**
 * Reads over the receipt half of the inventory subledger
 * (plans/purchasing/01-build-plan.md section 3.1).
 *
 * Reads only. The writes live in `receive-stock.ts` / `receive-purchase-order.ts`
 * because a file that both queries and mutates is the first step back toward a
 * service class (`docs/lib-module-guide.md` section 5).
 *
 * There are no permission checks here. The router asserts read access on the
 * part and passes the narrowed filters down; a lib read that
 * decided visibility for itself would have to be kept in step with the router
 * forever (`docs/lib-module-guide.md` section 6).
 */

import { type Database, schema } from '@auxx/database'
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { PART_FIELDS } from '../../resources/registry/resources/part-fields'
import { VENDOR_PART_FIELDS } from '../../resources/registry/resources/vendor-part-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import { readSystemRecords, systemFieldMap, systemFields } from '../../resources/system-records'
import { isUsableStoredStandard } from '../costing/client'
import { resolveOfferTariff } from '../costing/vendor-cost'
import type { StockMovementRow } from '../movements/reads'
import { loadTariffSchedule } from '../tariffs/tariff-schedule'
import type { ReceiptCostInputs } from './client'
import { guard } from './guard'
import type { ListReceiptsFilters, ReceiptRow } from './types'

const DEFAULT_LIMIT = 50

/**
 * List `receive` movements, newest `effectiveAt` first, paged in SQL so page two is page two of
 * the ordered set.
 */
export async function listReceipts(
  db: Database,
  organizationId: string,
  filters: ListReceiptsFilters = {}
): Promise<Result<ReceiptRow[], Error>> {
  return guard(
    async () => {
      const t = schema.StockMovement
      const where: SQL[] = [eq(t.organizationId, organizationId), eq(t.type, 'receive')]
      if (filters.since) where.push(gte(t.effectiveAt, filters.since))
      if (filters.until) where.push(lte(t.effectiveAt, filters.until))
      if (filters.partInstanceId) where.push(eq(t.partId, filters.partInstanceId))
      if (filters.vendorPartId) where.push(eq(t.vendorPartId, filters.vendorPartId))

      const rows = await db
        .select()
        .from(t)
        .where(and(...where))
        .orderBy(desc(t.effectiveAt), desc(t.createdAt), desc(t.id))
        .limit(filters.limit ?? DEFAULT_LIMIT)
        .offset(filters.offset ?? 0)
      return rows.map(toReceiptRow)
    },
    'Failed to list receipts',
    { organizationId, filters }
  )
}

function toReceiptRow(row: StockMovementRow): ReceiptRow {
  return {
    movementId: row.id,
    partInstanceId: row.partId,
    quantity: row.quantity,
    unitCost: row.unitCostMinor,
    extendedCost: row.extendedCostMinor,
    vendorUnitPrice: row.vendorUnitPriceMinor,
    vendorPartId: row.vendorPartId,
    glRole: row.glRole,
    purchaseOrderLineId: row.purchaseOrderLineId,
    reference: row.reference,
    occurredAt: row.effectiveAt,
    createdAt: row.createdAt,
  }
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
 * Movements with a NULL `unitCost` (pending) are skipped rather than ending the search.
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
 *
 * **The tariff rate is RESOLVED, not read** (29 §3.1, 30 §5). A set
 * `vendor_part_tariff_rate` is an override and wins outright; otherwise the
 * offer's `tariff_code` schedule is resolved at `atDate` in the org's book
 * timezone. `atDate` is the receipt's `occurredAt` - a receipt back-dated to
 * before a rate change is valued at the earlier rate, which is the whole point
 * of a dated schedule. ⚠️ This serves the AD-HOC receive door only;
 * `receivePurchaseOrder` passes `unitCost` explicitly and never reaches here
 * (29 §5.1).
 */
export async function readVendorPartCostInputs(
  db: Database,
  organizationId: string,
  vendorPartInstanceId: string,
  atDate: Date = new Date()
): Promise<Result<ReceiptCostInputs | null, Error>> {
  return guard(
    async () => {
      const ctx = await systemFields(db, organizationId, 'vendor_part', VENDOR_PART_PICK)
      if (!ctx) return null

      const [offer] = await readSystemRecords(db, organizationId, ctx, {
        ids: [vendorPartInstanceId],
      })
      if (!offer) return null

      const override = offer.number('vendor_part_tariff_rate')
      const tariffRate =
        override ??
        (await resolveScheduledRate(
          db,
          organizationId,
          offer.related('vendor_part_tariff_code'),
          atDate
        ))

      return {
        unitPrice: offer.number('vendor_part_unit_price'),
        shippingCost: offer.number('vendor_part_shipping_cost'),
        tariffRate,
        otherCost: offer.number('vendor_part_other_cost'),
      }
    },
    'Failed to read vendor part cost inputs',
    { organizationId, vendorPartInstanceId }
  )
}

const VENDOR_PART_PICK = pickSystemAttributes(VENDOR_PART_FIELDS, [
  'vendor_part_unit_price',
  'vendor_part_shipping_cost',
  'vendor_part_tariff_rate',
  'vendor_part_tariff_code',
  'vendor_part_other_cost',
] as const)

/**
 * The schedule half of the precedence rule for one offer: its `tariff_code`
 * pointer, that code's rows, and `resolveOfferTariff` at `atDate`. `null` when
 * the offer is unclassified, so the caller's `?? 0` reads the same as today.
 *
 * The schedule and the timezone are only fetched once a pointer is found.
 */
async function resolveScheduledRate(
  db: Database,
  organizationId: string,
  tariffCodeId: string | null,
  atDate: Date
): Promise<number | null> {
  if (!tariffCodeId) return null
  const [schedule, timeZone] = await Promise.all([
    loadTariffSchedule(db, organizationId, [tariffCodeId]),
    readBookTimeZoneOrUtc(organizationId),
  ])
  return resolveOfferTariff({ tariffRate: null, tariffCodeId }, schedule, atDate, timeZone).rate
}

/**
 * A part's `partKind`, or `null` when it has never been classified.
 *
 * NULL is returned as NULL rather than defaulted here on purpose: this is a
 * read, and the "NULL reads as component" rule is an interpretation that belongs
 * to whoever is interpreting it. {@link import('./client').resolveInventoryRoleForPartKind}
 * applies it for the GL account; the sale-path explode gate applies the OPPOSITE
 * default to the same NULL (costing plan section 4.3), and a read that had
 * already picked one would make the other impossible to express.
 *
 * Deliberately not on `readSystemRecords`: one attribute of one part, and
 * `receivePurchaseOrder` calls it once per line — the reader would add an
 * `EntityInstance` round trip to every one of them.
 */
export async function readPartKind(
  db: Database,
  organizationId: string,
  partInstanceId: string
): Promise<Result<string | null, Error>> {
  return guard(
    async () => {
      const fields = await systemFieldMap(db, organizationId, PART_KIND_PICK)
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

/**
 * One part's frozen standard cost and its display name, in a single query.
 *
 * An unusable stored value (negative, or a zero with no origin) reads as `null`, the same rule as
 * `readStandardCost`.
 *
 * 🛑 **Returns `standardCost: null` rather than a fallback.** The one number
 * that must never substitute for it is `part_cost`: that is LIVE REPLACEMENT
 * cost, rewritten on every vendor-price change, so valuing a movement with it
 * would silently restate the ledger the next time a supplier sent a price list.
 * Only `part_standard_cost` values a movement (architecture guide section 11,
 * rule 2). A caller with no standard cost must refuse, not guess.
 *
 * The `displayName` travels with it because every caller that has to refuse
 * needs to name the part — "this part has no standard cost" is unactionable
 * when a form is showing a name and the error is showing a cuid.
 *
 * Archived parts are included: a caller refusing one still has to name it.
 */
export async function readPartStandardCost(
  db: Database,
  organizationId: string,
  partInstanceId: string
): Promise<Result<{ standardCost: number | null; displayName: string | null }, Error>> {
  return guard(
    async () => {
      const ctx = await systemFields(db, organizationId, 'part', PART_STANDARD_COST_PICK)
      if (!ctx) return { standardCost: null, displayName: null }

      const [record] = await readSystemRecords(db, organizationId, ctx, {
        ids: [partInstanceId],
        includeArchived: true,
      })

      const stored = record?.number('part_standard_cost') ?? null
      const hasOrigin = record?.option('part_standard_cost_origin') != null
      return {
        standardCost: isUsableStoredStandard(stored, hasOrigin) ? stored : null,
        displayName: record?.displayName ?? null,
      }
    },
    'Failed to read part standard cost',
    { organizationId, partInstanceId }
  )
}

const PART_KIND_PICK = pickSystemAttributes(PART_FIELDS, ['part_kind'] as const)

const PART_STANDARD_COST_PICK = pickSystemAttributes(PART_FIELDS, [
  'part_standard_cost',
  'part_standard_cost_origin',
] as const)
