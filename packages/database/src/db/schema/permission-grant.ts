// packages/database/src/db/schema/permission-grant.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, jsonb, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { Organization } from './organization'
import { User } from './user'

/**
 * PermissionGrant — Layer-2 capability override grants (per-member permissions).
 *
 * ONE row per grantee (permission profile, group, or user) holding a sparse
 * per-area level map `{ areaSlug: Level }` (None/Read/Edit/Full — see
 * `capabilities/registry.ts`). An absent area is UNSET → it falls through to the
 * profile's `baseLevel`, then the code default, at compose time.
 *
 * Composition (v2 §2.1) splits these into tiers:
 *  - the bound **profile** row supplies the per-area BASE, so a stored
 *    `Level.None` there is LOAD-BEARING (it genuinely zeroes the area for every
 *    holder of that profile — it is the one downward lever, inherited from the
 *    now-deleted `role:org_member` policy tier);
 *  - group + user grants RAISE it (`max`, Camp-1 raise-only), so a stored `None`
 *    on those tiers is inert and is stripped on write;
 *  - the bound profile's own `ceiling.areas` clamps, and the seat ceiling clamps
 *    last (`min`).
 *
 * A `granteeType:'profile'` row's `granteeId` is a `PermissionProfile.id`. There
 * is no FK on `granteeId`, so profile deletion must remove the row explicitly.
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

    /**
     * Type of grantee receiving the capability. Plain `text()`, not a pgEnum, so
     * extending the union needs no DB migration.
     */
    granteeType: text().notNull().$type<'role' | 'group' | 'user' | 'profile'>(),

    /**
     * ID of the grantee — interpreted based on granteeType:
     * - 'profile' -> PermissionProfile.id (the human area BASE, v2 §1.2)
     * - 'group'   -> EntityInstance.id (entity_group)
     * - 'user'    -> User.id
     * - 'role'    -> role slug. LEGACY: the `org_member` policy tier was deleted
     *   in plan 19 step 2 (its levels were copied onto each org's `member`
     *   profile row); no composer reads a `role` grant on this table anymore.
     */
    granteeId: text().notNull(),

    /**
     * Sparse per-area level map `{ areaSlug: Level }` — only the areas this grant
     * sets are present; an absent area is UNSET and falls through to the bound
     * profile's `baseLevel` and then the code default at compose time.
     * Validated/coerced via `parseAreaLevels`.
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
