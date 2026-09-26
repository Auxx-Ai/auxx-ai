// packages/lib/src/data-migrations/migrations/198-sidebar-default-layout.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { inArray } from 'drizzle-orm'
import { updateOrganizationSetting } from '../../settings/settings-service'
import { SIDEBAR_DEFAULT_LAYOUT_SETTING_KEY } from '../../sidebar-layout/constants'
import {
  type LegacyEntitySidebarSettings,
  snapshotFromLegacyEntitySettings,
} from '../../sidebar-layout/snapshot'
import type { SidebarLayoutSnapshot } from '../../sidebar-layout/types'
import type { DataMigrationDef } from '../types'

const logger = createScopedLogger('migration-198')

const LEGACY_KEYS: Record<string, keyof LegacyEntitySidebarSettings> = {
  'sidebar.entities.order': 'order',
  'sidebar.entities.visibility': 'visibility',
  'sidebar.entities.groupVisible': 'groupVisible',
  'sidebar.entities.folders': 'folders',
  'sidebar.entities.folderItems': 'folderItems',
}

/**
 * One snapshot per org that stored any legacy Records setting and has no
 * `sidebar.defaultLayout` yet. Orgs that never touched Records keep the code default.
 */
export function planSidebarDefaultLayouts(
  rows: readonly { organizationId: string; key: string; value: unknown }[]
): Map<string, SidebarLayoutSnapshot> {
  const legacyByOrg = new Map<string, LegacyEntitySidebarSettings>()
  const hasDefault = new Set<string>()
  for (const row of rows) {
    if (row.key === SIDEBAR_DEFAULT_LAYOUT_SETTING_KEY) {
      if (row.value != null) hasDefault.add(row.organizationId)
      continue
    }
    const field = LEGACY_KEYS[row.key]
    if (!field) continue
    const legacy = legacyByOrg.get(row.organizationId) ?? {}
    legacy[field] = row.value
    legacyByOrg.set(row.organizationId, legacy)
  }

  const out = new Map<string, SidebarLayoutSnapshot>()
  for (const [organizationId, legacy] of legacyByOrg) {
    if (hasDefault.has(organizationId)) continue
    out.set(organizationId, snapshotFromLegacyEntitySettings(legacy))
  }
  return out
}

/**
 * Convert each org's legacy org-wide Records layout (`sidebar.entities.*`) into a
 * `sidebar.defaultLayout` snapshot (plans/sidebar/01-unified-sidebar.md §8), so members
 * who never customize keep seeing today's layout. Legacy keys are left in place; phase 2
 * removes them with the hook. Idempotent: an org with a snapshot is skipped.
 */
export const migration198SidebarDefaultLayout: DataMigrationDef = {
  id: '198-sidebar-default-layout',
  description:
    'Convert legacy sidebar.entities.* Records settings into a sidebar.defaultLayout snapshot',
  async run(db: Database): Promise<void> {
    const rows = await db
      .select({
        organizationId: schema.OrganizationSetting.organizationId,
        key: schema.OrganizationSetting.key,
        value: schema.OrganizationSetting.value,
      })
      .from(schema.OrganizationSetting)
      .where(
        inArray(schema.OrganizationSetting.key, [
          ...Object.keys(LEGACY_KEYS),
          SIDEBAR_DEFAULT_LAYOUT_SETTING_KEY,
        ])
      )

    const planned = planSidebarDefaultLayouts(rows)
    for (const [organizationId, snapshot] of planned) {
      await updateOrganizationSetting({
        organizationId,
        key: SIDEBAR_DEFAULT_LAYOUT_SETTING_KEY,
        value: snapshot,
        db,
      })
    }
    logger.info('Sidebar default layouts converted', { orgs: planned.size })
  },
}
