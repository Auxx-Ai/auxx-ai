// packages/lib/src/seed/entity-migrations/migrations/024-thread-visit-fields.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { THREAD_FIELDS } from '../../../resources/registry/resources/thread-fields'
import { ensureCustomFields, loadExistingState } from '../helpers'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:024')

/**
 * Migration 024: Add the chat "visit" system fields to the thread entity.
 *
 * These are FieldValue-backed fields (keyed by `thread.id`, like `thread_tags`)
 * capturing the per-conversation visit facts — IP, user agent, referrer,
 * landing URL, and resolved geo. New orgs get them from `createAllFields`; this
 * backfills the `CustomField` rows for orgs created before the chat-visit PR.
 *
 * Note: this id reuses the `024` global-sequence number also held by the
 * data-migration `024-verify-credential-v2-backfill`. They live in separate
 * folders and the registry keys on the full id string, so both coexist. Kept as
 * `024` to match the ledger row this already wrote when it ran — renaming would
 * orphan that row and leave the new id unreachable behind that failed neighbor.
 */
export const migration024ThreadVisitFields: EntityMigration = {
  id: '024-thread-visit-fields',
  description: 'Add chat visit system fields (ip/user-agent/referrer/url/geo) to thread',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const threadDef = existing.entityDefs.get('thread')
    if (!threadDef) {
      logger.warn('No thread entity found, skipping visit fields', { organizationId })
      return { ...state, alreadyUpToDate: true }
    }

    await ensureCustomFields(
      db,
      organizationId,
      'thread',
      threadDef.id,
      {
        visitIp: THREAD_FIELDS.visitIp!,
        visitUserAgent: THREAD_FIELDS.visitUserAgent!,
        visitReferrer: THREAD_FIELDS.visitReferrer!,
        visitUrl: THREAD_FIELDS.visitUrl!,
        visitCity: THREAD_FIELDS.visitCity!,
        visitRegion: THREAD_FIELDS.visitRegion!,
        visitCountry: THREAD_FIELDS.visitCountry!,
        visitTimezone: THREAD_FIELDS.visitTimezone!,
      },
      existing,
      state
    )

    const alreadyUpToDate = state.fieldsCreated === 0

    if (!alreadyUpToDate) {
      logger.info('Migration 024 applied', {
        organizationId,
        fieldsCreated: state.fieldsCreated,
      })
    }

    return { ...state, alreadyUpToDate }
  },
}
