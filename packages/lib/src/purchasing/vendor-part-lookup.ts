// packages/lib/src/purchasing/vendor-part-lookup.ts

/**
 * The `(part, supplier)` read behind a purchase order line's price prefill
 * (plans/purchasing/05-receiving-cost-and-corrections.md section 5.2).
 *
 * Read only. There is nothing to write here: the caller stamps
 * `purchase_order_line_vendor_part` and `purchase_order_line_expected_unit_price`
 * through the ordinary field-value path, which is what keeps the prefill a
 * PREFILL — a value a person can overwrite — rather than a derivation.
 *
 * No permission checks. The router asserts view access on the `vendor_part`
 * definition and calls in (`docs/lib-module-guide.md` section 6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { err, ok, type Result } from 'neverthrow'
import { getCachedEntityDefId, getOrgCache } from '../cache'
import { AuxxError } from '../errors'

const logger = createScopedLogger('purchasing:vendor-part-lookup')

/**
 * What one supplier's catalogue entry contributes to a purchase order line.
 *
 * 🛑 `unitPrice` is a **starting value, not an authority.** It is copied onto
 * `purchase_order_line_expected_unit_price` once, at pick time, and then frozen:
 * `vendor_part_unit_price` is `updatable: true` and `bom-cost-triggers.ts`
 * recalculates part costs whenever it moves, so a line that re-read its price
 * through this link would stop showing the price that was agreed. The agreed
 * price is the frozen copy on the line; this is only where the first draft of it
 * came from. See section 5.2 of the plan.
 */
export interface VendorPartPrefill {
  /**
   * The matched `vendor_part` row, as a `RecordId`.
   *
   * Returned already prefixed because this module has just resolved the
   * `vendor_part` definition id to run the query — making the caller resolve it
   * a second time to build the same string is a round trip for nothing.
   */
  vendorPartRecordId: RecordId
  /**
   * `vendor_part_unit_price` in integer minor units, or `null` when the supplier
   * has a catalogue entry for this part but no price on it.
   *
   * The two are genuinely different answers and the caller must not collapse
   * them: a `null` here still means "this IS the supplier row for this line", so
   * the provenance link is still worth stamping — there is simply no number to
   * prefill with.
   */
  unitPrice: number | null
}

/** Where the lookup reads from — one part, one supplier, both as instance ids. */
export interface VendorPartLookupParams {
  /** `EntityInstance.id` of the `part` just picked on the line. */
  partInstanceId: string
  /** `EntityInstance.id` of the purchase order's own vendor (`purchase_order_vendor`). */
  vendorInstanceId: string
}

/**
 * The one `vendor_part` row for a `(part, supplier)` pair, or `null`.
 *
 * ✅ **Unambiguous by schema.** `vendor_part` carries an enforced natural key
 * `(part, supplier)` — `naturalKeyPosition: 1` on `vendor_part_part`,
 * `2` on `vendor_part_contact` — so this resolves to at most one live row. That
 * is why there is no `onAmbiguous` parameter here and no `ilike` anywhere in the
 * query: the pair IS the identity, and matching it is an equality on two
 * relationship values.
 *
 * ⚠️ **Never falls back to the preferred vendor.** `bom/cost-calculator.ts:141`
 * uses `vendor_part_is_preferred` that way, but it is answering a different
 * question — *replacement cost for this part, from whoever we would buy it from*.
 * Here the supplier is already decided by the order, so a preferred-vendor
 * fallback would put a DIFFERENT supplier's price on this supplier's purchase
 * order and record a link that names a row the order has nothing to do with. No
 * row for this pair means no prefill; the price is typed by hand.
 *
 * `null` is returned — rather than an error — for every "there is nothing to
 * prefill from" shape: no `vendor_part` definition in this org yet, the
 * relationship fields not materialised, or simply no catalogue entry for the
 * pair. A missing prefill is not a failure of the pick.
 *
 * The `orderBy` exists only to make an unexpected duplicate deterministic. Under
 * the natural key there is at most one row, so it never changes which row is
 * returned; without it a violated key would return a different price per call.
 */
export async function findVendorPartForLine(
  db: Database,
  organizationId: string,
  params: VendorPartLookupParams
): Promise<Result<VendorPartPrefill | null, Error>> {
  const { partInstanceId, vendorInstanceId } = params
  try {
    const vendorPartDefId = await getCachedEntityDefId(organizationId, 'vendor_part')
    if (!vendorPartDefId) return ok(null)

    const fields = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes([
        'vendor_part_part',
        'vendor_part_contact',
        'vendor_part_unit_price',
      ] as const)

    const partField = fields.vendor_part_part
    const supplierField = fields.vendor_part_contact
    // Both legs of the natural key are required to identify a row. Matching on
    // one alone would return "any vendor part for this part" — which is the
    // preferred-vendor fallback this function exists to refuse.
    if (!partField || !supplierField) return ok(null)

    const partValue = alias(schema.FieldValue, 'vendor_part_part_value')
    const supplierValue = alias(schema.FieldValue, 'vendor_part_supplier_value')

    const [row] = await db
      .select({ id: schema.EntityInstance.id })
      .from(schema.EntityInstance)
      .innerJoin(
        partValue,
        and(
          eq(partValue.entityId, schema.EntityInstance.id),
          eq(partValue.organizationId, schema.EntityInstance.organizationId),
          eq(partValue.fieldId, partField.id),
          eq(partValue.relatedEntityId, partInstanceId)
        )
      )
      .innerJoin(
        supplierValue,
        and(
          eq(supplierValue.entityId, schema.EntityInstance.id),
          eq(supplierValue.organizationId, schema.EntityInstance.organizationId),
          eq(supplierValue.fieldId, supplierField.id),
          eq(supplierValue.relatedEntityId, vendorInstanceId)
        )
      )
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.entityDefinitionId, vendorPartDefId),
          isNull(schema.EntityInstance.archivedAt)
        )
      )
      .orderBy(schema.EntityInstance.createdAt)
      .limit(1)

    if (!row) return ok(null)

    // Read as a second statement rather than a third join: the price is optional
    // on the row AND its field may not be materialised on a mid-migration org, so
    // a join would have to be conditional and the projection with it.
    const priceField = fields.vendor_part_unit_price
    let unitPrice: number | null = null
    if (priceField) {
      const [priceRow] = await db
        .select({ valueNumber: schema.FieldValue.valueNumber })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            eq(schema.FieldValue.entityId, row.id),
            eq(schema.FieldValue.fieldId, priceField.id)
          )
        )
        .limit(1)
      unitPrice = priceRow?.valueNumber ?? null
    }

    return ok({ vendorPartRecordId: toRecordId(vendorPartDefId, row.id), unitPrice })
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to look up vendor part for a purchase order line', {
      error,
      organizationId,
      partInstanceId,
      vendorInstanceId,
    })
    return err(new AuxxError('Internal error'))
  }
}

/**
 * Which of these parts this supplier ALREADY has a catalogue entry for.
 *
 * One statement for the whole set, where {@link findVendorPartForLine} is one
 * per pair — the caller is answering a question about a list (a quote's lines,
 * a write-back offer), and N round trips to render one dialog is the shape the
 * tier ladder was written to avoid.
 *
 * 🛑 Returns only what EXISTS. A part id absent from the map has no
 * `(part, supplier)` row, which is a materially different act for the caller: an
 * absent pair means a write CREATES a `vendor_part` — a new catalogue entry that
 * then participates in pricing and preferred-vendor reads — where a present one
 * only sets a field on a row that was already there. A screen that offers both
 * under one label is asking for a decision it has hidden half of.
 *
 * Same natural key and the same refusals as {@link findVendorPartForLine}: both
 * legs matched as equalities, no preferred-vendor fallback, and an empty map
 * rather than an error for every "there is nothing here yet" shape.
 */
export async function findVendorPartsForParts(
  db: Database,
  organizationId: string,
  params: { vendorInstanceId: string; partInstanceIds: string[] }
): Promise<Result<Map<string, RecordId>, Error>> {
  const { vendorInstanceId, partInstanceIds } = params
  const found = new Map<string, RecordId>()
  if (partInstanceIds.length === 0) return ok(found)

  try {
    const vendorPartDefId = await getCachedEntityDefId(organizationId, 'vendor_part')
    if (!vendorPartDefId) return ok(found)

    const fields = await getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes(['vendor_part_part', 'vendor_part_contact'] as const)

    const partField = fields.vendor_part_part
    const supplierField = fields.vendor_part_contact
    if (!partField || !supplierField) return ok(found)

    const partValue = alias(schema.FieldValue, 'vendor_part_part_value')
    const supplierValue = alias(schema.FieldValue, 'vendor_part_supplier_value')

    const rows = await db
      .select({
        id: schema.EntityInstance.id,
        partInstanceId: partValue.relatedEntityId,
      })
      .from(schema.EntityInstance)
      .innerJoin(
        partValue,
        and(
          eq(partValue.entityId, schema.EntityInstance.id),
          eq(partValue.organizationId, schema.EntityInstance.organizationId),
          eq(partValue.fieldId, partField.id),
          inArray(partValue.relatedEntityId, [...new Set(partInstanceIds)])
        )
      )
      .innerJoin(
        supplierValue,
        and(
          eq(supplierValue.entityId, schema.EntityInstance.id),
          eq(supplierValue.organizationId, schema.EntityInstance.organizationId),
          eq(supplierValue.fieldId, supplierField.id),
          eq(supplierValue.relatedEntityId, vendorInstanceId)
        )
      )
      .where(
        and(
          eq(schema.EntityInstance.organizationId, organizationId),
          eq(schema.EntityInstance.entityDefinitionId, vendorPartDefId),
          isNull(schema.EntityInstance.archivedAt)
        )
      )

    for (const row of rows) {
      if (!row.partInstanceId) continue
      // First wins, matching `findVendorPartForLine`'s `orderBy … limit 1`. Under
      // the natural key there is at most one row per pair anyway.
      if (!found.has(row.partInstanceId)) {
        found.set(row.partInstanceId, toRecordId(vendorPartDefId, row.id))
      }
    }

    return ok(found)
  } catch (error) {
    if (error instanceof AuxxError) return err(error)
    logger.error('Failed to look up vendor parts for a set of parts', {
      error,
      organizationId,
      vendorInstanceId,
      parts: partInstanceIds.length,
    })
    return err(new AuxxError('Internal error'))
  }
}
