// packages/database/src/db/schema/sidebar-node.ts
// Drizzle table: SidebarNode — a member's sidebar tree (groups → folders → items, incl. favorites)

import { createId } from '@paralleldrive/cuid2'
import { textCollateC } from './_collations'
import {
  type AnyPgColumn,
  boolean,
  index,
  jsonb,
  pgTable,
  sidebarNodeType,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { Organization } from './organization'
import { OrganizationMember } from './organization-member'
import { User } from './user'

/** One node of a member's sidebar; see plans/sidebar/01-unified-sidebar.md §3. */
export const SidebarNode = pgTable(
  'SidebarNode',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),

    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    organizationMemberId: text()
      .notNull()
      .references((): AnyPgColumn => OrganizationMember.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    userId: text()
      .notNull()
      .references((): AnyPgColumn => User.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    nodeType: sidebarNodeType().notNull(),

    /** GROUP + FOLDER display title. */
    title: text(),

    /** GROUP only: 'favorites' | 'workspace' | 'records'. */
    systemKey: text(),

    /** ITEM only: a favorite target type, 'NAV' or 'ENTITY_DEFINITION'. */
    targetType: text(),
    targetIds: jsonb(),

    // Deletes re-home children in the service first; the cascade is only a backstop.
    parentId: text().references((): AnyPgColumn => SidebarNode.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),

    sortOrder: textCollateC().notNull(),
    isHidden: boolean().default(false).notNull(),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('SidebarNode_member_idx').using('btree', table.organizationMemberId.asc().nullsLast()),
    index('SidebarNode_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('SidebarNode_parentId_idx').using('btree', table.parentId.asc().nullsLast()),
    uniqueIndex('SidebarNode_member_systemKey_uq')
      .on(table.organizationMemberId, table.systemKey)
      .where(sql`${table.systemKey} is not null`),
  ]
)

export type SidebarNodeEntity = typeof SidebarNode.$inferSelect
