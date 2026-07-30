// packages/database/src/db/schema/resource-access.ts

import { createId } from '@paralleldrive/cuid2'
import type { ResourceGranteeType, Rung } from '../../enums'
import { type AnyPgColumn, check, index, pgTable, sql, text, timestamp, unique } from './_shared'
import { Organization } from './organization'
import { User } from './user'

/**
 * ResourceAccess table for generic resource-level access control.
 *
 * Supports granting access to any entity type or specific instance
 * to any grantee type (group, user, team, role).
 *
 * Examples:
 * - Group "Sales" has "view" access to Inbox "Support" (entityDefinitionId='inbox', entityInstanceId=<inbox-id>)
 * - User "alice" has "edit" access to ALL Snippets (entityDefinitionId='snippet', entityInstanceId=null)
 * - Role "org_member" has "view" access to custom entity "Product" type (entityDefinitionId=<product-def-id>, entityInstanceId=null)
 * - Group "VIP Support" has "admin" access to specific Product instance (entityDefinitionId=<product-def-id>, entityInstanceId=<product-id>)
 */
export const ResourceAccess = pgTable(
  'ResourceAccess',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),

    /** Organization scope - all access is org-scoped */
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    // ─────────────────────────────────────────────────────────────────────────
    // RESOURCE (what is being accessed)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * What kind of thing is being accessed. Two disjoint keyspaces share this
     * column:
     *
     * 1. **An `EntityDefinition.id` (CUID)** — a CRM record type, system or
     *    custom. These rows are type- or instance-level RECORD restriction, read
     *    by `canViewRecord` / `canViewEntity`.
     *
     * 2. **A reserved slug** — a built-in domain with no `EntityDefinition` row.
     *    Two families, with different readers:
     *      - **Mail / messaging infrastructure**: `'inbox'`, `'thread'`,
     *        `'message'`, `'signature'`, `'snippet'`, `'sequence'`. These carry
     *        mail-SHARING semantics (see `rung`), not def restriction, and are
     *        read by the instance-grant composer.
     *      - **Instance-access resources**: `'dataset'`, `'kb'`, `'dashboard'`,
     *        `'workflow'` — the authoritative list is
     *        `INSTANCE_ACCESS_RESOURCES` in
     *        `@auxx/lib/permissions/capabilities/instance-access`, and
     *        `isInstanceAccessKey()` is the guard. Each pairs an L2 area with
     *        per-instance grants; `entityInstanceId` holds the resource's own
     *        cuid2 (`Dataset.id`, `KnowledgeBase.id`, `Dashboard.id`,
     *        `WorkflowApp.id`), NOT an `EntityInstance.id`.
     *
     * Deliberately NOT in either family: `'article'` (inherits its KB's grants —
     * no per-article rows are ever written). `'folder'` and `'document'` were
     * listed here historically but nothing has ever written them.
     *
     * Keep this list in sync with `INSTANCE_ACCESS_RESOURCES` and with
     * `NON_RECORD_DEF_SLUGS` (`permissions/capabilities/entity-access.ts`) plus
     * its hand-kept client mirror `NON_RECORD_ENTITY_SLUGS`
     * (`resources/registry/types.ts`).
     */
    entityDefinitionId: text().notNull(),

    /**
     * Specific entity instance ID (optional).
     * - null = access to ALL instances of this entity type
     * - <id> = access to this specific instance only
     *
     * For built-in types:
     * - 'inbox' + entityInstanceId = Inbox.id
     * - 'snippet' + entityInstanceId = Snippet.id
     *
     * For custom entities:
     * - entityDefinitionId + entityInstanceId = EntityInstance.id
     */
    entityInstanceId: text(),

    // ─────────────────────────────────────────────────────────────────────────
    // GRANTEE (who is being granted access)
    // ─────────────────────────────────────────────────────────────────────────

    /** Type of grantee receiving access */
    granteeType: text().notNull().$type<ResourceGranteeType>(),

    /**
     * ID of the grantee - interpreted based on granteeType:
     * - 'group' -> EntityInstance.id (entity_group)
     * - 'user' -> User.id
     * - 'team' -> EntityInstance.id (team/group)
     * - 'role' -> Role identifier string (e.g., 'org_member', 'org_admin')
     */
    granteeId: text().notNull(),

    // ─────────────────────────────────────────────────────────────────────────
    // GRANT LEVEL
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * The rung this grant confers — ONE ordinal ladder for every domain
     * (plan v3/03 §2/§3):
     *
     * ```
     * none < metadata < identity < read < edit < admin
     * ```
     *
     * Replaces the two-column `(permission, lens)` encoding, whose product space
     * was larger than its meaning: `lens` was readable only on
     * `permission = 'view'`, so three separate readers each had to spell out
     * `permission === 'view' ? (lens ?? 'full') : 'full'` — and one of them once
     * read the `permission = 'none'` RESTRICTION marker as a full grant.
     *
     * Migration mapping (total and lossless): `none/*` → `none`,
     * `view/metadata` → `metadata`, `view/subject` → `identity`,
     * `view/(full|NULL)` → `read`, `edit/*` → `edit`, `admin/*` → `admin`.
     *
     * ⚠ **`none` is a RESTRICTION marker, never a grant.** A `role:org_member @
     * none` row says "this instance is row-described and this grantee is not on
     * the list"; it ranks below every positive rung and can only narrow. See
     * `project_permission_none_is_a_restriction`.
     *
     * Which rungs a given domain may take is declared per-domain in
     * `INSTANCE_ACCESS_RESOURCES`
     * (`@auxx/lib/permissions/capabilities/instance-access`); the CHECK below is
     * the DB-level floor under all of them.
     *
     * NOT a `ResourcePermission`. That vocabulary survives, unchanged, as the
     * DEF/AREA axis — `defAccess`, `effectiveRecordLevel`, the L2 `Level`
     * mapping — which composes area levels as well as rows. Type rows are read
     * into it through `rungToPermission` at exactly the read boundary.
     */
    rung: text().notNull().$type<Rung>(),

    // ─────────────────────────────────────────────────────────────────────────
    // AUDIT
    // ─────────────────────────────────────────────────────────────────────────

    /** User who granted this access */
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
    // Unique access grant per entity + grantee combination. NULLS NOT DISTINCT so
    // type-level rows (entityInstanceId null) collapse to one per grantee — a plain
    // unique index treats NULLs as distinct, so `grantType`'s onConflictDoUpdate
    // never fired for them and every change inserted a duplicate. Requires PG 15+
    // (Railway pgvector qualifies). Also the arbiter for grant/set upserts.
    unique('ResourceAccess_entity_grantee_key')
      .on(
        table.organizationId,
        table.entityDefinitionId,
        table.entityInstanceId,
        table.granteeType,
        table.granteeId
      )
      .nullsNotDistinct(),

    // Efficient lookups by entity definition (for type-level queries)
    index('ResourceAccess_entityDef_idx').using(
      'btree',
      table.entityDefinitionId.asc().nullsLast()
    ),

    // Efficient lookups by specific instance
    index('ResourceAccess_instance_idx').using(
      'btree',
      table.entityDefinitionId.asc().nullsLast(),
      table.entityInstanceId.asc().nullsLast()
    ),

    // Efficient lookups by grantee (for "what can this group access?")
    index('ResourceAccess_grantee_idx').using(
      'btree',
      table.granteeType.asc().nullsLast(),
      table.granteeId.asc().nullsLast()
    ),

    // Org-scoped queries
    index('ResourceAccess_org_idx').using('btree', table.organizationId.asc().nullsLast()),

    // The GRANTEE-DRIVEN arm (plan v3/03 §3 / §5.1 arm 3): "which instances of
    // this def does this principal hold a row on", org-scoped. None of the five
    // indexes above serves it — `ResourceAccess_grantee_idx` is
    // `(granteeType, granteeId)` with no org and no def, so the grant-only lane
    // (a member who cannot see the def at all and is reachable ONLY through
    // explicit rows) would scan every grant every grantee in the org holds.
    //
    // ⚠ The generated SQL adds `INCLUDE ("entityInstanceId", "rung")` by hand —
    // drizzle-kit has no INCLUDE builder. That is a deliberate, one-directional
    // divergence: drizzle-kit diffs the schema against its own snapshot JSON
    // (never against the live database), and the snapshot records this
    // four-column definition, so no future `db:generate` sees a change. If this
    // index is ever redefined, re-add the INCLUDE by hand in the new migration.
    index('ResourceAccess_grantee_def_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.granteeType.asc().nullsLast(),
      table.granteeId.asc().nullsLast(),
      table.entityDefinitionId.asc().nullsLast()
    ),

    // The only DB-level guard against a buggy write path putting an unknown
    // string on the ladder — every comparator is `RUNG_ORDER[value] >= n`, and
    // an unmapped value reads `undefined >= n`, i.e. FALSE everywhere. That
    // fails closed for a positive requirement but ALSO fails closed for the
    // `none` restriction marker, so a typo'd rung is simultaneously unusable and
    // unenforceable. Drop and recreate this constraint in the same migration
    // that ever adds a rung.
    check(
      'ResourceAccess_rung_check',
      sql`${table.rung} IN ('none', 'metadata', 'identity', 'read', 'edit', 'admin')`
    ),
  ]
)

/** Type for selecting from ResourceAccess table */
export type ResourceAccessEntity = typeof ResourceAccess.$inferSelect

/** Type for inserting into ResourceAccess table */
export type ResourceAccessInsert = typeof ResourceAccess.$inferInsert
