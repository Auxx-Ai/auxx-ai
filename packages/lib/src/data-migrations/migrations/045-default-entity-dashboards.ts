// packages/lib/src/data-migrations/migrations/045-default-entity-dashboards.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { DEFAULT_DASHBOARD_CONFIGS } from '../../seed/default-dashboard-configs'
import { buildResolvableFieldMap, loadExistingState } from '../../seed/entity-helpers'
import { ensureDefaultDashboard } from '../../seed/entity-seeder/create-default-dashboards'
import { SystemUserService } from '../../users/system-user-service'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:045')

/**
 * Migration 045: seed the default entity dashboards (Dashboards v2 plan 03 — ticket, contact,
 * company; README decision 6/7) for orgs that existed before this feature shipped. Fresh orgs
 * get the same templates from `EntitySeeder.seedSystemEntities()` Pass 8.
 *
 * Idempotent by construction: `ensureDefaultDashboard` skips any entity type that already has a
 * live OR archived dashboard linked (never resurrects one a user deleted), and each of the 3
 * entity types is independent, so a partial prior run (e.g. only `ticket` seeded before a
 * deploy) picks up exactly the missing ones on re-run.
 */
export const migration045DefaultEntityDashboards: PerOrgMigration = {
  id: '045-default-entity-dashboards',
  description: 'Seed default ticket/contact/company dashboards (Dashboards v2 plan 03)',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const existing = await loadExistingState(db, organizationId)
    const entityTypes = Object.keys(DEFAULT_DASHBOARD_CONFIGS)
    const fieldMap = buildResolvableFieldMap(existing, entityTypes)

    const userId = await SystemUserService.getSystemUserForActions(organizationId)

    let dashboardsCreated = 0
    for (const entityType of entityTypes) {
      const def = DEFAULT_DASHBOARD_CONFIGS[entityType]
      if (!def) continue
      const created = await ensureDefaultDashboard(
        db,
        organizationId,
        userId,
        entityType,
        def,
        existing.entityDefs,
        fieldMap
      )
      if (created) dashboardsCreated++
    }

    const alreadyUpToDate = dashboardsCreated === 0
    if (!alreadyUpToDate) {
      logger.info('Migration 045 applied', { organizationId, dashboardsCreated })
    }

    // Not entity defs / fields / relationships — `PerOrgMigrationResult`'s counters don't have a
    // dashboards field, so this migration only ever reports zero there; `alreadyUpToDate` is what
    // actually reflects whether anything happened.
    return { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0, alreadyUpToDate }
  },
}
