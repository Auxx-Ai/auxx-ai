// packages/lib/src/seed/entity-migrations/migrations/112-record-documents.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import type { ResourceField } from '../../../resources/registry/field-types'
import { INVOICE_FIELDS } from '../../../resources/registry/resources/invoice-fields'
import { PURCHASE_ORDER_FIELDS } from '../../../resources/registry/resources/purchase-order-fields'
import { QUOTE_FIELDS } from '../../../resources/registry/resources/quote-fields'
import { VENDOR_BILL_FIELDS } from '../../../resources/registry/resources/vendor-bill-fields'
import { buildFieldOptions, mapCapabilities } from '../../entity-seeder/utils'
import { ensureCustomFields, fieldKey, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:112')

const REGISTRIES: Record<string, Record<string, ResourceField>> = {
  quote: QUOTE_FIELDS,
  invoice: INVOICE_FIELDS,
  purchase_order: PURCHASE_ORDER_FIELDS,
  vendor_bill: VENDOR_BILL_FIELDS,
}

/**
 * The two genuinely NEW fields. Listed by registry key rather than taken as
 * "everything new on that registry", the discipline 109/111 record — a later
 * unrelated field cannot silently join this migration's payload.
 */
const NEW_FIELDS: Record<string, readonly string[]> = {
  purchase_order: ['attachments'],
  vendor_bill: ['attachments'],
}

/**
 * The four fields that CHANGE TYPE, `TEXT` → `FILE`.
 *
 * These are the whole reason this is a migration and not a re-run of `108`:
 * `ensureCustomFields` is INSERT-only — an existing `(entityDefId,
 * systemAttribute)` row is put in the field map and `continue`d, never compared
 * and never updated. Editing the registry changes what a NEW org gets and
 * changes nothing for one that already has the field.
 */
const CONVERSIONS: readonly { entityType: string; key: string; systemAttribute: string }[] = [
  { entityType: 'quote', key: 'pdfAsset', systemAttribute: 'quote_pdf_asset' },
  { entityType: 'invoice', key: 'pdfAsset', systemAttribute: 'invoice_pdf_asset' },
  {
    entityType: 'purchase_order',
    key: 'pdfAsset',
    systemAttribute: 'purchase_order_pdf_asset',
  },
  { entityType: 'vendor_bill', key: 'document', systemAttribute: 'vendor_bill_document' },
]

/**
 * Migration 112: documents on a record
 * (plans/purchasing/08-documents-on-records.md §5).
 *
 * ## What changes
 *
 * Two new multi `FILE` fields — `purchase_order_attachments` and
 * `vendor_bill_attachments` — plus four existing `TEXT` pointer fields converted
 * to single `FILE` fields:
 *
 * | field | was | becomes |
 * | --- | --- | --- |
 * | `quote_pdf_asset` | hidden TEXT, a bare MediaAsset id | single FILE, `isUpdatable: false` |
 * | `invoice_pdf_asset` | same | same |
 * | `purchase_order_pdf_asset` | same | same |
 * | `vendor_bill_document` | hidden TEXT, no reader and no writer anywhere | single FILE, user-writable |
 *
 * ## Why convert rather than add a second field
 *
 * The render pipeline already keeps exactly ONE `MediaAsset` per document and
 * adds a `MediaAssetVersion` per content change, so "single, and a new render
 * replaces the old" is what it already does — the `TEXT` type was the only thing
 * describing it wrongly. Two fields holding the same asset id would be drift by
 * construction: the renderer writes one, the card reads the other, and the first
 * disagreement is invisible.
 *
 * ## `isUpdatable: false` on the three generated pointers
 *
 * 🛑 Load-bearing, not tidiness. `ensureDocumentPdf` reads the pointer, loads
 * that `MediaAsset`, and appends a new VERSION to it when the stored
 * `contentHash` disagrees with the payload's. A file a person uploaded has no
 * `contentHash` at all, so the comparison always fails — point the field at a
 * user's file and the next send silently republishes their file as our PDF.
 *
 * `isUpdatable` is what closes that: it is read by the grid cell
 * (`selectable-table-cell.tsx`), the panel, the dialogs and connector
 * writability, and is NOT read by the field-value write path — so it locks every
 * human door and leaves `ensureDocumentPdf` untouched. That asymmetry is the
 * entire point, and it is the same move `079-enrichment-fields-backend-owned`
 * made for the company enrichment markers.
 *
 * Flipping the registry alone would reach only orgs seeded afterwards, which is
 * precisely the gap `078` and `079` exist to close.
 *
 * ## Id space
 *
 * 112 was the next free number counted across BOTH `data-migrations/migrations/`
 * (which reaches 105) and `seed/entity-migrations/migrations/` (which reaches
 * 111), and verified with `git log --all` against every branch — the space is
 * shared and has already collided once, at 103.
 *
 * **No DDL.** Everything here is `CustomField` and `FieldValue` rows. If a
 * `.sql` file appears under `packages/database/drizzle/` for this work,
 * something is wrong.
 *
 * Idempotent in all three parts: `ensureCustomFields` skips an existing field,
 * the `CustomField` update's `WHERE` matches only rows still in the old shape,
 * and the value move only touches rows that still carry `valueText`.
 */
export const migration112RecordDocuments: EntityMigration = {
  id: '112-record-documents',
  description:
    'Files on a record: PO/bill attachment fields, and the generated document PDFs converted ' +
    'from hidden TEXT pointers into read-only single FILE fields',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)
    let changed = false

    // ── 1. The two new attachment fields ────────────────────────────────────
    for (const [entityType, keys] of Object.entries(NEW_FIELDS)) {
      const def = existing.entityDefs.get(entityType)
      // Absent rather than failed: an org short of 108 has no purchasing defs at
      // all, and 108 seeds each registry in full, so a later run picks these up.
      if (!def) continue

      const fields: Record<string, ResourceField> = {}
      for (const key of keys) {
        const field = REGISTRIES[entityType]?.[key]
        // Loud rather than silent: a renamed registry key would otherwise make
        // this migration quietly create one field fewer than it claims to.
        if (!field) {
          throw new Error(`${entityType} registry is missing the key "${key}" (migration 112)`)
        }
        fields[key] = field
      }

      await ensureCustomFields(db, organizationId, entityType, def.id, fields, existing, state)
    }

    // ── 2. TEXT → FILE on the four pointer fields ───────────────────────────
    for (const conversion of CONVERSIONS) {
      const def = existing.entityDefs.get(conversion.entityType)
      if (!def) continue

      const row = existing.fields.get(fieldKey(def.id, conversion.systemAttribute))
      if (!row) continue

      const field = REGISTRIES[conversion.entityType]?.[conversion.key]
      if (!field) {
        throw new Error(
          `${conversion.entityType} registry is missing the key "${conversion.key}" (migration 112)`
        )
      }

      const options = buildFieldOptions(field)
      const capabilities = mapCapabilities(field.capabilities)

      const updated = await db
        .update(schema.CustomField)
        .set({
          name: field.label,
          description: field.description,
          type: field.fieldType!,
          options,
          ...capabilities,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.CustomField.id, row.id),
            // Only rows still in the old shape, so a re-run is a no-op. `type` is
            // the load-bearing half; the rest are reconciled alongside it.
            or(
              ne(schema.CustomField.type, field.fieldType!),
              ne(schema.CustomField.name, field.label),
              ne(schema.CustomField.isUpdatable, capabilities.isUpdatable),
              ne(schema.CustomField.options, options)
            )
          )
        )
        .returning({ id: schema.CustomField.id })

      changed ||= updated.length > 0

      // ── 3. Move the values: `valueText` → the `{ v, meta }` FILE envelope ──
      //
      // ⚠️ The stored shape is the envelope, NOT a bare `{ ref }` — verified
      // against a live `company_logo` row: `{"v":{"ref":"asset:<id>"}}`. Writing
      // the bare object here would produce a value that every FILE reader in the
      // product silently skips.
      //
      // `valueText` is nulled in the same statement: a row carrying both columns
      // is a row two readers disagree about. `sortKey` is left alone — these rows
      // already sit at `a0`, which is exactly position 0 for a FILE field.
      const moved = await db
        .update(schema.FieldValue)
        .set({
          valueJson: sql`jsonb_build_object('v', jsonb_build_object('ref', 'asset:' || ${schema.FieldValue.valueText}))`,
          valueText: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.FieldValue.fieldId, row.id),
            eq(schema.FieldValue.organizationId, organizationId),
            isNotNull(schema.FieldValue.valueText),
            ne(schema.FieldValue.valueText, ''),
            isNull(schema.FieldValue.valueJson)
          )
        )
        .returning({ id: schema.FieldValue.id })

      if (moved.length > 0) {
        changed = true
        logger.info('Converted pointer values to FILE envelopes', {
          organizationId,
          systemAttribute: conversion.systemAttribute,
          rows: moved.length,
        })
      }
    }

    const alreadyUpToDate = state.fieldsCreated === 0 && !changed

    // A converted field is still TEXT to every read path until the per-org
    // caches serving it are dropped — and a FILE write validated against a
    // cached TEXT definition is rejected, invisibly, until something evicts.
    // `runEntityMigrationsForOrg` clears these after the batch, but `up()` can
    // also be invoked directly, so it clears its own.
    if (!alreadyUpToDate) {
      await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
      logger.info('Migration 112 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate }
  },
}
