// packages/lib/src/seed/entity-migrations/migrations/128-invoice-written-off.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateKeyBetween } from '@auxx/utils/fractional-indexing'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getOrgCache } from '../../../cache'
import type { ResourceField } from '../../../resources/registry/field-types'
import { INVOICE_FIELDS } from '../../../resources/registry/resources/invoice-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:128')

/** The def that receives the field. */
const INVOICE_ENTITY_TYPE = 'invoice'

/** Listed by REGISTRY KEY, so a later unrelated field cannot join this payload. */
const FIELD_KEYS = ['writtenOff'] as const

/** The `sourceType` `build-write-off-entry.ts` stamps on every write-off line. */
const WRITE_OFF_SOURCE_TYPE = 'invoice'

/**
 * The posting statuses that mean the entry is in (or claiming to be in) the
 * books. `failed` never reached them, and `reversed` is the ORIGINAL half of a
 * reversed pair - excluding it and counting only `reversesId IS NULL` rows nets
 * a reversal out on both sides in one predicate.
 */
const LIVE_POSTING_STATUSES = ['posted', 'pending'] as const

/**
 * Migration 128: `invoice_written_off`, the cumulative bad debt taken off one
 * invoice.
 *
 * ## Why it exists
 *
 * A PARTIAL write-off was silently one-shot. `buildWriteOffEntry` keyed
 * `periodKey` on the invoice number alone, so a second write-off claimed the
 * same `(organizationId, write_off, periodKey, revision = 0)` tuple, `postEntry`
 * answered `already_posted` - a SUCCESS - and nothing posted while the caller
 * reported that it had. The key now carries an attempt, which is half the fix;
 * this field is the other half. Without it there is no durable record of what
 * has already been written off, so a second write-off cannot know what is left
 * and cannot be refused for exceeding it. The only trace used to be a reduction
 * of `invoice_balance`, which `syncInvoicePaymentState` re-derives as
 * `total - amountPaid` on the next payment event and so undoes.
 *
 * ## The backfill, and why it reads the LEDGER
 *
 * The amount already written off is not recoverable from the invoice - that is
 * the whole defect - but it is exactly recoverable from `GlPosting`: every
 * write-off is one `write_off` entry whose `totalMinor` is the amount and whose
 * lines carry `sourceType = 'invoice'`, `sourceId = <the invoice>`. Summed over
 * an org's live, non-reversal write-off postings, that IS the cumulative figure,
 * to the cent, and it is the same number a trial balance shows in bad debt.
 *
 * 🛑 Backfilled HERE, inline, rather than left to a separate data migration:
 * an org that gained the field with no value would let the next write-off take
 * the whole balance off A/R a second time, which is the bug this closes.
 *
 * ## Id space
 *
 * 128 is reserved for this work. The space is shared between
 * `data-migrations/migrations/` and `seed/entity-migrations/migrations/` and has
 * already collided once, at 103.
 *
 * **No DDL.** The field is a `CustomField` row on an existing def and the
 * backfill writes `FieldValue` rows; nothing here touches a Postgres table. If a
 * `.sql` file appears under `packages/database/drizzle/` for this work,
 * something is wrong.
 *
 * Idempotent - `ensureCustomFields` skips a field that already exists, and the
 * backfill only inserts where no `FieldValue` is present.
 */
export const migration128InvoiceWrittenOff: EntityMigration = {
  id: '128-invoice-written-off',
  description:
    'Add invoice_written_off, the cumulative bad debt taken off an invoice, and backfill it ' +
    'from the write_off postings already in the ledger, so a partial write-off can be topped ' +
    'up without taking the same receivable off A/R twice',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const def = existing.entityDefs.get(INVOICE_ENTITY_TYPE)
    // Absent rather than failed: an org with no `invoice` def has nothing to
    // widen, and the seeder creates the field with the rest of the registry.
    if (!def) return { ...state, alreadyUpToDate: true }

    const fields: Record<string, ResourceField> = {}
    for (const key of FIELD_KEYS) {
      const field = INVOICE_FIELDS[key]
      // Loud rather than silent: a renamed registry key would otherwise make
      // this migration quietly create one field fewer than it claims to.
      if (!field) {
        throw new Error(`invoice registry is missing the key "${key}" (migration 128)`)
      }
      fields[key] = field
    }

    const created = await ensureCustomFields(
      db,
      organizationId,
      INVOICE_ENTITY_TYPE,
      def.id,
      fields,
      existing,
      state
    )

    const fieldId = created.get(`${INVOICE_ENTITY_TYPE}:${INVOICE_FIELDS.writtenOff!.id}`)?.id
    if (!fieldId) {
      throw new Error(`migration 128 could not resolve the invoice_written_off field for ${def.id}`)
    }

    const backfilled = await backfillWrittenOff(db, organizationId, def.id, fieldId)

    const changed = state.fieldsCreated > 0 || backfilled > 0
    // A new field is invisible to every read path until the per-org caches that
    // serve it are dropped. `runEntityMigrationsForOrg` does this after the
    // whole batch, but `up()` can also be invoked directly, so it clears its own.
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, ['customFields', 'resources'])
      logger.info('Migration 128 applied', { organizationId, ...state, backfilled })
    }
    return { ...state, alreadyUpToDate: !changed }
  },
}

/**
 * Sum every live `write_off` posting per invoice and write the total onto the
 * invoices that do not carry one yet. Returns how many rows were inserted.
 */
export async function backfillWrittenOff(
  db: Database,
  organizationId: string,
  entityDefinitionId: string,
  fieldId: string
): Promise<number> {
  const rows = await db
    .selectDistinct({
      postingId: schema.GlPosting.id,
      invoiceId: schema.GlPostingLine.sourceId,
      totalMinor: schema.GlPosting.totalMinor,
    })
    .from(schema.GlPostingLine)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingLine.glPostingId))
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        eq(schema.GlPosting.postingType, 'write_off'),
        inArray(schema.GlPosting.status, [...LIVE_POSTING_STATUSES]),
        // 🛑 A reversal carries the same lines with the legs swapped and the
        // original is left `reversed`, so counting only originals that are
        // still live nets a reversed pair out to nothing without a second query.
        isNull(schema.GlPosting.reversesId),
        eq(schema.GlPostingLine.sourceType, WRITE_OFF_SOURCE_TYPE)
      )
    )
  if (rows.length === 0) return 0

  const byInvoice = new Map<string, number>()
  for (const row of rows) {
    byInvoice.set(row.invoiceId, (byInvoice.get(row.invoiceId) ?? 0) + Number(row.totalMinor))
  }

  const invoiceIds = [...byInvoice.keys()]
  const present = await db
    .select({ entityId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, fieldId),
        inArray(schema.FieldValue.entityId, invoiceIds)
      )
    )
  const alreadyWritten = new Set(present.map((row) => row.entityId))

  const now = new Date()
  const inserts = invoiceIds
    .filter((invoiceId) => !alreadyWritten.has(invoiceId))
    .map((invoiceId) => ({
      organizationId,
      entityId: invoiceId,
      entityDefinitionId,
      fieldId,
      sortKey: generateKeyBetween(null, null),
      valueNumber: byInvoice.get(invoiceId) as number,
      updatedAt: now,
    }))
  if (inserts.length === 0) return 0

  await db.insert(schema.FieldValue).values(inserts)
  return inserts.length
}
