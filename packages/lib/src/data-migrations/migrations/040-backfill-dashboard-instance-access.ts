// packages/lib/src/data-migrations/migrations/040-backfill-dashboard-instance-access.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { isNull } from 'drizzle-orm'
import { emitResourceAccessInstanceChanged } from '../../resource-access'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-040')

const DASHBOARD_KEY = 'dashboard'
const WORKSPACE_BASELINE_GRANTEE = 'org_member'
const CHUNK = 1000

/**
 * Backfill instance-access `ResourceAccess` rows for every existing dashboard
 * (doc 13 §3) — the app-side write path (`insertPublishedDashboard`,
 * `updateDashboard`) only writes these for dashboards created/linked AFTER this
 * slice shipped. Every dashboard needs a workspace-baseline row (`role` /
 * `org_member`) plus an `admin` owner row (when it has a human owner), because
 * `dashboard` is `baselineAtCreate: true` (doc 13 §0.1) — a dashboard with no
 * instance rows resolves to NO ACCESS for everyone, including its creator.
 *
 * Deliberately does NOT read `Dashboard.visibility` — that column is dropped in
 * the same slice as this migration, so depending on it here would make this
 * migration's correctness order-dependent on running before the drop. Every
 * backfilled dashboard gets an org-shared (`'view'`) baseline regardless of its
 * old `visibility` value — the safe default (doc 13 §7 open item #3 recommends
 * "Shared" as the default; a dashboard someone actually wanted private can be
 * flipped via the Share card after this runs). Chunked (~1000/insert, migration
 * 032 precedent) and idempotent via `onConflictDoNothing` — never stomps a row
 * the app already wrote, safe to re-run.
 */
export const migration040BackfillDashboardInstanceAccess: DataMigrationDef = {
  id: '040-backfill-dashboard-instance-access',
  description:
    'Backfill dashboard workspace-baseline + owner ResourceAccess rows (does not read Dashboard.visibility)',
  async run(db: Database): Promise<void> {
    const dashboards = await db
      .select({
        id: schema.Dashboard.id,
        organizationId: schema.Dashboard.organizationId,
        createdById: schema.Dashboard.createdById,
      })
      .from(schema.Dashboard)
      .where(isNull(schema.Dashboard.archivedAt))

    if (dashboards.length === 0) {
      logger.info('No dashboards to backfill')
      return
    }

    const rows: (typeof schema.ResourceAccess.$inferInsert)[] = []
    const affectedOrgIds = new Set<string>()
    for (const d of dashboards) {
      affectedOrgIds.add(d.organizationId)
      rows.push({
        organizationId: d.organizationId,
        entityDefinitionId: DASHBOARD_KEY,
        entityInstanceId: d.id,
        granteeType: ResourceGranteeType.role,
        granteeId: WORKSPACE_BASELINE_GRANTEE,
        permission: ResourcePermission.view,
        grantedById: d.createdById,
      })
      if (d.createdById) {
        rows.push({
          organizationId: d.organizationId,
          entityDefinitionId: DASHBOARD_KEY,
          entityInstanceId: d.id,
          granteeType: ResourceGranteeType.user,
          granteeId: d.createdById,
          permission: ResourcePermission.admin,
          grantedById: d.createdById,
        })
      }
    }

    let written = 0
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      await db.insert(schema.ResourceAccess).values(chunk).onConflictDoNothing()
      written += chunk.length
    }

    // Bust `restrictedInstanceIds` (org) + `userCapabilities` (broadcast) for
    // every affected org — without this, backfilled dashboards stay invisible
    // until each org's caches naturally expire (doc 13 §4 caveat).
    for (const orgId of affectedOrgIds) {
      await emitResourceAccessInstanceChanged(orgId, [
        { granteeType: ResourceGranteeType.role, granteeId: WORKSPACE_BASELINE_GRANTEE },
      ])
    }

    logger.info('Backfilled dashboard instance access', {
      dashboards: dashboards.length,
      rowsWritten: written,
      orgsInvalidated: affectedOrgIds.size,
    })
  },
}
