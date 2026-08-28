// packages/lib/src/seed/entity-migrations/migrations/110-build-visible.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import type { EntityMigration, EntityMigrationResult } from '../types'

const logger = createScopedLogger('entity-migrations:110')

/** The one def this migration reveals. */
export const BUILD_ENTITY_TYPE = 'build'

/**
 * Decide what to do with one org's `build` def row.
 *
 * - `update`     — the row still carries the seeded `false`.
 * - `up-to-date` — already visible; a re-run, or a fresh org seeded after the
 *   `SYSTEM_ENTITIES` flip that ships alongside this file.
 *
 * There is no `skip` arm, and that is the difference from
 * {@link resolveRelabel} in migration 102. A label is something an organization
 * can legitimately have customized, so 102 has to tell "still seeded" from
 * "theirs". `EntityDefinition.isVisible` has exactly one writer in the whole
 * codebase — `ensureEntityDefinitions`, at creation time — and the sidebar's
 * own hide/show toggle persists to the `sidebar.entities.visibility` **org
 * setting** instead (`use-entity-sidebar.tsx`). So a `false` here is always the
 * seeded value and never somebody's choice, and this migration cannot overrule
 * a preference that has no way to be expressed on this column.
 */
export function resolveBuildVisibility(isVisible: boolean): 'update' | 'up-to-date' {
  return isVisible ? 'up-to-date' : 'update'
}

/**
 * Migration 110: make the `build` entity visible now that it has a UI
 * (plans/products/build/01-build-plan.md §3.3, §3.6).
 *
 * ## Why this is a migration and not one line
 *
 * §3.3 says phase 2's schema work is "one line: flip the def to
 * `isVisible: true`". That is wrong, and silently so.
 * `ensureEntityDefinitions` (`../helpers.ts`) is a plain `insert` that
 * `continue`s past any org already holding the def — `isVisible: entity.isVisible
 * ?? true` is only ever evaluated when the row is CREATED. Migration 109 already
 * created the `build` def in every org at `isVisible: false`, so editing
 * `SYSTEM_ENTITIES` alone reaches no existing organization at all: it would flip
 * the flag for orgs created after the deploy and leave every current one with a
 * complete, working builds UI that has no way into it.
 *
 * The `SYSTEM_ENTITIES` edit still ships — it is what a fresh org seeds from,
 * and leaving the two disagreeing is how a def ends up meaning one thing on old
 * orgs and another on new ones. This migration is the other half.
 *
 * ## What `isVisible: true` actually turns on
 *
 * The Records sidebar group (`use-entity-sidebar.tsx` filters
 * `resource.isVisible !== false`) and the kbar search / create pages. Nothing is
 * registered by hand: the sidebar builds the href as `/app/${apiSlug}` for a
 * system entity, which is `/app/builds`, and that route folder lands with this
 * change. ⚠️ **The nav entry 404s without it** — which is the other half of why
 * 109 shipped the def hidden.
 *
 * Idempotent, and no field, relationship or view work: 109 created all 24
 * `BUILD_FIELDS` and linked every edge. This touches exactly one boolean column.
 * Cache invalidation is the runner's: any org whose result is not
 * `alreadyUpToDate` gets `entityDefs` / `entityDefSlugs` / `customFields` /
 * `resources` recomputed.
 */
export const migration110BuildVisible: EntityMigration = {
  id: '110-build-visible',
  description: 'Make the build entity visible in the sidebar now that the builds UI has landed',

  async up(db: Database, organizationId: string): Promise<EntityMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }

    const [def] = await db
      .select({
        id: schema.EntityDefinition.id,
        isVisible: schema.EntityDefinition.isVisible,
      })
      .from(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.organizationId, organizationId),
          eq(schema.EntityDefinition.entityType, BUILD_ENTITY_TYPE),
          isNull(schema.EntityDefinition.archivedAt)
        )
      )
      .limit(1)

    // The org predates the def entirely. Not an error and not something to fix
    // here: 109 runs before this in the same ordered registry, so an absent row
    // means 109 could not create it either, and 109 is where that is diagnosed.
    if (!def) return { ...state, alreadyUpToDate: true }

    if (resolveBuildVisibility(def.isVisible) === 'up-to-date') {
      return { ...state, alreadyUpToDate: true }
    }

    await db
      .update(schema.EntityDefinition)
      .set({ isVisible: true })
      .where(eq(schema.EntityDefinition.id, def.id))

    logger.info('Migration 110 applied', { organizationId, entityDefinitionId: def.id })
    return { ...state, alreadyUpToDate: false }
  },
}
