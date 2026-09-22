// packages/lib/src/data-migrations/migrations/186-drop-posting-markers.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:186')

/** Literals, not registry references: the registry no longer declares them (179's rule). */
const REMOVED_BY_DEF: ReadonlyArray<[entityType: string, attributes: readonly string[]]> = [
  ['fulfillment', ['fulfillment_posting_blocked_reason', 'fulfillment_posting_blocked_at']],
  ['credit_memo', ['credit_memo_issue_blocked_reason', 'credit_memo_issue_blocked_at']],
  ['payout', ['payout_blocked_reason']],
]

/** A removed field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

export interface Migration186Result extends PerOrgMigrationResult {
  fieldsRemoved: number
}

/**
 * Migration 186: drop the five marker fields `AccountingWorkItem` replaces
 * (`plans/accounting/tasks/91-one-entry-per-event.md` §4.6, U5). `FieldValue.fieldId`
 * cascades, so the stored reasons go with them. Idempotent; an org short of a def skips it.
 */
export const migration186DropPostingMarkers: PerOrgMigration = {
  id: '186-drop-posting-markers',
  description:
    'Removes fulfillment_posting_blocked_*, credit_memo_issue_blocked_* and ' +
    'payout_blocked_reason - parked work is an AccountingWorkItem row now (91 §4.6)',

  async up(db: Database, organizationId: string): Promise<Migration186Result> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    let fieldsRemoved = 0
    for (const [entityType, attributes] of REMOVED_BY_DEF) {
      const def = existing.entityDefs.get(entityType)
      if (!def) continue
      const removed = await db
        .delete(schema.CustomField)
        .where(
          and(
            eq(schema.CustomField.organizationId, organizationId),
            eq(schema.CustomField.entityDefinitionId, def.id),
            inArray(schema.CustomField.systemAttribute, [...attributes])
          )
        )
        .returning({ id: schema.CustomField.id })
      fieldsRemoved += removed.length
    }

    if (fieldsRemoved > 0) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 186 applied', { organizationId, fieldsRemoved })
    }
    return { ...state, alreadyUpToDate: fieldsRemoved === 0, fieldsRemoved }
  },
}
