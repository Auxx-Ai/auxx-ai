// packages/lib/src/data-migrations/migrations/053-seed-agent-preset-profiles.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { onCacheEvent } from '../../cache'
import { ensureSystemProfiles } from '../../permissions/profiles'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-053')

/**
 * Seed the two new agent preset profiles (`support_agent`, `analyst_agent` —
 * plan 23 §2.3) into every EXISTING org. New orgs get them through the
 * org-creation call to `ensureSystemProfiles`; this backfill covers orgs
 * created before the seeds existed.
 *
 * Idempotent and re-runnable: `ensureSystemProfiles` inserts with
 * `onConflictDoNothing` on `(organizationId, slug)`, so pre-existing rows —
 * including admin-edited system rows — are never touched, and a re-run
 * inserts nothing.
 *
 * Cache: only the org `profiles` projection carries profile rows, so the
 * `permission-profile.changed` event WITHOUT `broadcastUserKeys` suffices —
 * agent-only profiles never feed user-capability composition, so no member
 * blob is stale.
 */
export const migration053SeedAgentPresetProfiles: DataMigrationDef = {
  id: '053-seed-agent-preset-profiles',
  description:
    'Seed the support_agent and analyst_agent system permission profiles into every existing org',
  async run(db: Database): Promise<void> {
    const orgs = await db.select({ id: schema.Organization.id }).from(schema.Organization)
    if (orgs.length === 0) {
      logger.info('No organizations to seed')
      return
    }

    for (const org of orgs) {
      await ensureSystemProfiles(org.id, db)
      await onCacheEvent('permission-profile.changed', { orgId: org.id })
    }

    logger.info('Seeded agent preset profiles', { orgs: orgs.length })
  },
}
