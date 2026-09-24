// packages/lib/src/data-migrations/migrations/189-thread-triage-fields.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getOrgCache } from '../../cache'
import type { ResourceField } from '../../resources/registry/field-types'
import { THREAD_FIELDS } from '../../resources/registry/resources/thread-fields'
import { ensureCustomFields, loadExistingState } from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:189')

const THREAD = 'thread'
const TRIAGE_KEYS = ['priority', 'needsReply', 'sentiment', 'spamScore'] as const

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 189: the four mail-classification triage fields on `thread`, each backed
 * by a `Thread` column (plans/ai/decision/03-mail-classification.md §5.2).
 *
 * No backfill: the columns are NULL until a message is classified. Idempotent —
 * `ensureCustomFields` is INSERT-only.
 */
export const migration189ThreadTriageFields: PerOrgMigration = {
  id: '189-thread-triage-fields',
  description:
    'Adds thread.priority, needsReply, sentiment and spamScore — the triage mail ' +
    'classification writes to Thread columns (decision 03 §5). No backfill',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const threadDef = existing.entityDefs.get(THREAD)
    if (!threadDef) return { ...state, alreadyUpToDate: true }

    const fields: Record<string, ResourceField> = {}
    for (const key of TRIAGE_KEYS) {
      const field = THREAD_FIELDS[key]
      if (!field) throw new Error(`The thread registry is missing ${key} (migration 189)`)
      fields[key] = field
    }

    await ensureCustomFields(db, organizationId, THREAD, threadDef.id, fields, existing, state)

    const changed = state.fieldsCreated > 0
    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 189 applied', { organizationId, fieldsCreated: state.fieldsCreated })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}
