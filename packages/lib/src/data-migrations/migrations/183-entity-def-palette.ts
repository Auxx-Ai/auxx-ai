// packages/lib/src/data-migrations/migrations/183-entity-def-palette.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { SYSTEM_ENTITIES } from '../../seed/entity-seeder/constants'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:183')

/** `Resource` carries `icon`/`color`, so a stale entry renders the old palette for a day. */
const CACHE_KEYS = ['resources'] as const

/**
 * Migration 183: restamp every system `EntityDefinition`'s icon and colour from
 * {@link SYSTEM_ENTITIES} (`plans/icons/entity-def-palette.md` §3).
 *
 * ## Unconditional, by decision (§4)
 *
 * A system def's appearance is ours: the appearance editor is rendered
 * `disabled={!!resource.entityType}`, so no customer can have set these. There is nothing
 * to preserve and no `from` table to compare against — which is why this reads
 * `SYSTEM_ENTITIES` directly and therefore cannot drift from the registry.
 *
 * Idempotent: the equality skip means a second run writes nothing. Safe to re-apply with
 * `packages/lib/scripts/run-entity-migration.ts --id 183-entity-def-palette`.
 */
export const migration183EntityDefPalette: PerOrgMigration = {
  id: '183-entity-def-palette',
  description:
    'Restamps system EntityDefinition icon/color from SYSTEM_ENTITIES - colour becomes the ' +
    'accounting axis (sell green, buy red, goods teal, cash blue, ledger gray)',

  async up(db: Database, organizationId: string): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const rows = await db
      .select({
        id: schema.EntityDefinition.id,
        entityType: schema.EntityDefinition.entityType,
        icon: schema.EntityDefinition.icon,
        color: schema.EntityDefinition.color,
      })
      .from(schema.EntityDefinition)
      .where(eq(schema.EntityDefinition.organizationId, organizationId))

    const byType = new Map(rows.filter((r) => r.entityType != null).map((r) => [r.entityType, r]))

    const now = new Date()
    let restamped = 0

    for (const entity of SYSTEM_ENTITIES) {
      const def = byType.get(entity.entityType)
      // Absent means the org predates the def; seeding it is the seeder's job, not this one's.
      if (!def) continue
      if (def.icon === entity.icon && def.color === entity.color) continue

      await db
        .update(schema.EntityDefinition)
        .set({ icon: entity.icon, color: entity.color, updatedAt: now })
        .where(
          and(
            eq(schema.EntityDefinition.id, def.id),
            eq(schema.EntityDefinition.organizationId, organizationId)
          )
        )
      restamped++
    }

    if (restamped > 0) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 183 applied', { organizationId, restamped })
    }

    return { ...state, alreadyUpToDate: restamped === 0 }
  },
}
