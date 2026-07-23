// packages/database/src/db/schema/permission-grant.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, jsonb, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { Organization } from './organization'
import { User } from './user'

/**
 * PermissionGrant — Layer-2 capability override grants (per-member permissions).
 *
 * ONE row per grantee (org role policy, group, or user) holding a sparse
 * per-area level map `{ areaSlug: Level }` (None/Read/Edit/Full — see
 * `capabilities/registry.ts`). An absent area is UNSET → it falls through to the
 * code default at compose time. Composition (§5) splits these into three tiers:
 * the `role:org_member` policy replaces the USER baseline per set area, group +
 * user grants raise it (`max`), and the seat ceiling clamps last (`min`). Camp-1
 * most-permissive — there is no deny effect.
 *
 * Deliberately NOT rows in `ResourceAccess`: that table is per-resource-instance
 * ACL (lens semantics); capabilities are per-area. Same grantee vocabulary so
 * sharing-UI primitives are reusable, different table so neither system's
 * queries/invalidations pollute the other. See
 * plans/permissions/capability-layer-v1.5-leveled-model.md §7.
 */
export const PermissionGrant = pgTable(
  'PermissionGrant',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),

    /** Organization scope — all grants are org-scoped */
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    /** Type of grantee receiving the capability */
    granteeType: text().notNull().$type<'role' | 'group' | 'user'>(),

    /**
     * ID of the grantee — interpreted based on granteeType:
     * - 'role'  -> role slug ('org_member', …)
     * - 'group' -> EntityInstance.id (entity_group)
     * - 'user'  -> User.id
     */
    granteeId: text().notNull(),

    /**
     * Sparse per-area level map `{ areaSlug: Level }` — only the areas this grant
     * sets are present; an absent area is UNSET and falls through to the code
     * default at compose time. Validated/coerced via `parseAreaLevels`.
     */
    levels: jsonb().$type<Partial<Record<string, number>>>().notNull(),

    /** User who created this grant */
    grantedById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One grant row per grantee — also serves grantee lookups.
    uniqueIndex('PermissionGrant_grantee_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.granteeType.asc().nullsLast(),
      table.granteeId.asc().nullsLast()
    ),
  ]
)

/** Type for selecting from PermissionGrant table */
export type PermissionGrantEntity = typeof PermissionGrant.$inferSelect

/** Type for inserting into PermissionGrant table */
export type PermissionGrantInsert = typeof PermissionGrant.$inferInsert
