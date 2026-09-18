// packages/lib/src/data-migrations/migrations/170-gl-account-parent-field.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { getOrgCache } from '../../cache'
import { GL_ACCOUNT_FIELDS } from '../../resources/registry/resources/gl-account-fields'
import {
  ensureCustomFields,
  linkNewRelationships,
  loadExistingState,
} from '../../seed/entity-helpers'
import type { PerOrgMigration, PerOrgMigrationResult } from '../per-org'

const logger = createScopedLogger('entity-migrations:170')

const GL_ACCOUNT_ENTITY_TYPE = 'gl_account'

/** A new field is invisible to every read path that serves it until these drop. */
const CACHE_KEYS = ['customFields', 'resources'] as const

/**
 * Migration 170: `gl_account` learns `parent` / `children`
 * (plans/accounting/CHART-HIERARCHY.md D1/§2).
 *
 * ## Why a migration and not just the registry edit
 *
 * `gl-account-fields.ts`'s two new fields reach a FRESH org through the
 * seeder; an org that already has a `gl_account` def gets nothing from a
 * registry edit alone. `ensureCustomFields` is INSERT-only and skips a def
 * that already holds the attribute, so a re-run is free.
 *
 * ## Self-referential, so both halves are linked in ONE field map
 *
 * `parent` and `children` are the same shape `149-shipment-parcel.ts` links
 * for two different defs, narrowed to one: both point `relationship.
 * inverseResourceFieldId` at `gl_account:<the other field>`, and
 * `linkNewRelationships` resolves that by a direct key lookup into the field
 * map it is handed. Ensuring them in two separate calls would leave each
 * field's inverse invisible to the other and skip the pair with nothing
 * louder than a debug line - the 135/136 lesson `149` restates, so this
 * asserts the link explicitly rather than trusting the debug line.
 *
 * ## No backfill
 *
 * Every existing account decodes `parentId: null` the moment the field
 * exists (D1) - absence means top-level, so there is nothing to backfill and
 * every current chart is already valid.
 */
export const migration170GlAccountParentField: PerOrgMigration = {
  id: '170-gl-account-parent-field',
  description:
    'Adds the self-referential parent / children relationship fields to the gl_account def ' +
    '(CHART-HIERARCHY.md D1).',

  async up(db, organizationId): Promise<PerOrgMigrationResult> {
    const state = { entityDefsCreated: 0, fieldsCreated: 0, relationshipsLinked: 0 }
    const existing = await loadExistingState(db, organizationId)

    const glAccountDef = existing.entityDefs.get(GL_ACCOUNT_ENTITY_TYPE)
    if (!glAccountDef) {
      // A fresh org gets the whole shape, self-relation included, from the
      // registry via the ordinary seeder.
      return { ...state, alreadyUpToDate: true }
    }

    const parentField = GL_ACCOUNT_FIELDS.parent
    const childrenField = GL_ACCOUNT_FIELDS.children
    if (!parentField || !childrenField) {
      throw new Error(
        "gl-account-fields registry is missing 'parent' or 'children' (migration 170)"
      )
    }

    const fieldMap = await ensureCustomFields(
      db,
      organizationId,
      GL_ACCOUNT_ENTITY_TYPE,
      glAccountDef.id,
      { parent: parentField, children: childrenField },
      existing,
      state
    )

    const entityDefIds = new Map([[GL_ACCOUNT_ENTITY_TYPE, glAccountDef.id]])
    await linkNewRelationships(db, fieldMap, entityDefIds, state)
    await assertInversesLinked(db, fieldMap)

    const changed = state.fieldsCreated > 0 || state.relationshipsLinked > 0

    if (changed) {
      await getOrgCache().invalidateAndRecompute(organizationId, [...CACHE_KEYS])
      logger.info('Migration 170 applied', { organizationId, ...state })
    }

    return { ...state, alreadyUpToDate: !changed }
  },
}

/**
 * Fail loudly when a relationship half was created but never linked - an
 * unlinked `parent` would accept writes the `children` side can never read
 * back, and `preventCircular`/`maxDepth` are asserted against the LINKED
 * shape, not the raw field.
 */
async function assertInversesLinked(
  db: Database,
  fieldMap: Map<string, { id: string }>
): Promise<void> {
  const pairs = [
    { owning: 'gl_account:parent', inverse: 'gl_account:children' },
    { owning: 'gl_account:children', inverse: 'gl_account:parent' },
  ] as const

  for (const { owning, inverse } of pairs) {
    const field = fieldMap.get(owning)
    if (!field) continue // not created this run - already linked by an earlier one
    const row = await db.query.CustomField.findFirst({
      where: eq(schema.CustomField.id, field.id),
      columns: { options: true },
    })
    const inverseId = (row?.options as { relationship?: { inverseResourceFieldId?: string } })
      ?.relationship?.inverseResourceFieldId
    if (!inverseId) {
      throw new Error(
        `migration 170 created ${owning} but could not link it to ${inverse} - the inverse half ` +
          'is missing, and an unlinked relationship writes rows the other side cannot see'
      )
    }
  }
}
