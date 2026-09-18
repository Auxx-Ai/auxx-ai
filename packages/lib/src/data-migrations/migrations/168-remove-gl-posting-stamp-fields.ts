// packages/lib/src/data-migrations/migrations/168-remove-gl-posting-stamp-fields.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:168')

/**
 * The six `*_gl_posting[_id]` stamp fields TARGET.md §1 retires in step 1b:
 * every record's postings are read through `listPostingsForSource`, off
 * `GlPostingSource`, never off a text backlink on the record. Literals, not
 * registry references - the registry no longer declares any of them (the
 * removal is the point), so a stored row is matched on what it was actually
 * seeded with.
 *
 * `journal_entry_gl_posting_id` is deliberately absent - TARGET §1 keeps it as
 * the pointer a journal-entry record needs to find its own draft/posted
 * `GlPosting`, since that record has no other way to name it.
 */
const REMOVED_STAMPS: readonly { entityType: string; systemAttribute: string }[] = [
  { entityType: 'fulfillment', systemAttribute: 'fulfillment_gl_posting' },
  { entityType: 'credit_memo', systemAttribute: 'credit_memo_gl_posting' },
  { entityType: 'payout', systemAttribute: 'payout_gl_posting_id' },
  { entityType: 'bank_deposit', systemAttribute: 'bank_deposit_gl_posting_id' },
  { entityType: 'bank_transaction', systemAttribute: 'bank_transaction_gl_posting_id' },
  { entityType: 'order', systemAttribute: 'order_payment_gl_posting' },
]

/** A removed field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

export interface Migration168Result extends PerOrgMigrationResult {
  /** Of the six stamps, how many existed on this org and were deleted (0-6). */
  stampsRemoved: number
}

/**
 * Migration 168: remove the six GL-posting stamp fields step 1b retires
 * (MIGRATION.md §0b, TARGET §1).
 *
 * ## Why a migration and not just the registry edit
 *
 * `CustomField` rows are seeded per org and only ADDED after that by a data
 * migration - nothing deletes one on a registry edit alone. Five of the six
 * stamps were added by local-only Drizzle migrations and could simply be
 * dropped from those migrations before they ever reached production (§0b) -
 * `credit_memo_gl_posting`'s migration, 152, is the one exception: it ran in
 * production (before `b11e32f4b`) and stays, so its field is still seeded on
 * every org that ran it and needs an explicit removal like the rest.
 *
 * `FieldValue.fieldId` is `ON DELETE CASCADE` (`field-value.ts`), so deleting
 * a `CustomField` row takes every value with it - no `FieldValue` sweep
 * needed, the same as migration 166's Part A.
 *
 * ## No backfill, no replacement read
 *
 * Every reader of these six fields was rewritten onto `listPostingsForSource`
 * before this migration runs (step 1b), so there is nothing to preserve: a
 * record's own postings are unaffected, only the redundant backlink goes.
 *
 * Idempotent: each delete is gated on the row still existing (`.returning()`
 * reports 0 for a field already gone), and an org short of a def is a SKIP on
 * that stamp alone, never a throw - a fresh install never seeds these fields
 * at all.
 */
export const migration168RemoveGlPostingStampFields: PerOrgMigration = {
  id: '168-remove-gl-posting-stamp-fields',
  description:
    'Removes the six GL-posting stamp fields step 1b retires - fulfillment_gl_posting, ' +
    'credit_memo_gl_posting, payout_gl_posting_id, bank_deposit_gl_posting_id, ' +
    'bank_transaction_gl_posting_id and order_payment_gl_posting. Every record posting is read ' +
    'through listPostingsForSource now, off GlPostingSource, never off a stamp field ' +
    '(plans/accounting/TARGET.md §1). journal_entry_gl_posting_id is not one of the six - it ' +
    'stays as the pointer a journal entry needs to find its own posting.',

  async up(db: Database, organizationId: string): Promise<Migration168Result> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    let stampsRemoved = 0
    for (const { entityType, systemAttribute } of REMOVED_STAMPS) {
      const def = existing.entityDefs.get(entityType)
      if (!def) continue // Absent rather than failed: a fresh install never seeds this field.

      const removed = await db
        .delete(schema.CustomField)
        .where(
          and(
            eq(schema.CustomField.organizationId, organizationId),
            eq(schema.CustomField.entityDefinitionId, def.id),
            eq(schema.CustomField.systemAttribute, systemAttribute)
          )
        )
        .returning({ id: schema.CustomField.id })
      stampsRemoved += removed.length
    }

    const changed = stampsRemoved > 0
    if (changed) {
      // The delete bypasses the org cache; a stale `customFields`/`resources`
      // entry would keep serving a field that no longer exists.
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 168 applied', { organizationId, stampsRemoved })
    }

    return { ...state, alreadyUpToDate: !changed, stampsRemoved }
  },
}
