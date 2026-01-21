// packages/database/src/db/schema/resource-access.ts

import { pgTable, uniqueIndex, index, text, timestamp, type AnyPgColumn } from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { User } from './user'
import { Organization } from './organization'
import type { ResourceGranteeType, ResourcePermission } from '../../enums'

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
     * Entity definition identifier - can be:
     * - An actual EntityDefinition.id (CUID) for custom entities
     * - A built-in type string: 'inbox', 'snippet', 'folder', 'workflow', 'document'
     *
     * This follows the codebase pattern where entityDefinitionId can reference
     * either custom entity definitions or built-in system types.
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
    // PERMISSION
    // ─────────────────────────────────────────────────────────────────────────

    /** Permission level granted */
    permission: text().notNull().$type<ResourcePermission>(),

    // ─────────────────────────────────────────────────────────────────────────
    // AUDIT
    // ─────────────────────────────────────────────────────────────────────────

    /** User who granted this access */
    grantedById: text().references((): AnyPgColumn => User.id, { onUpdate: 'cascade', onDelete: 'set null' }),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Unique access grant per entity + grantee combination
    // Note: entityInstanceId can be null (type-level access)
    uniqueIndex('ResourceAccess_entity_grantee_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.entityDefinitionId.asc().nullsLast(),
      table.entityInstanceId.asc().nullsLast(),
      table.granteeType.asc().nullsLast(),
      table.granteeId.asc().nullsLast()
    ),

    // Efficient lookups by entity definition (for type-level queries)
    index('ResourceAccess_entityDef_idx').using('btree', table.entityDefinitionId.asc().nullsLast()),

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
  ]
)

/** Type for selecting from ResourceAccess table */
export type ResourceAccessEntity = typeof ResourceAccess.$inferSelect

/** Type for inserting into ResourceAccess table */
export type ResourceAccessInsert = typeof ResourceAccess.$inferInsert
