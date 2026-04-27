// packages/database/src/db/schema/favorite.ts
// Drizzle table: favorite — personal sidebar favorites (items + folders)

import { createId } from '@paralleldrive/cuid2'
import { textCollateC } from './_collations'
import {
  type AnyPgColumn,
  favoriteNodeType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from './_shared'
import { Organization } from './organization'
import { OrganizationMember } from './organization-member'
import { User } from './user'

/** Drizzle table for favorite */
export const Favorite = pgTable(
  'Favorite',
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

    nodeType: favoriteNodeType().notNull(),

    title: text(),

    targetType: text(),
    targetIds: jsonb(),

    parentFolderId: text().references((): AnyPgColumn => Favorite.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),

    sortOrder: textCollateC().notNull(),

    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('Favorite_member_idx').using('btree', table.organizationMemberId.asc().nullsLast()),
    index('Favorite_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('Favorite_parentFolderId_idx').using('btree', table.parentFolderId.asc().nullsLast()),
  ]
)

export type FavoriteEntity = typeof Favorite.$inferSelect
