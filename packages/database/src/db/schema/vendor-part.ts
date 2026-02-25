// packages/database/src/db/schema/vendor-part.ts
// Drizzle table: vendorPart

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'

import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { Part } from './part'

/** Drizzle table for vendorPart */
export const VendorPart = pgTable(
  'VendorPart',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    partId: text()
      .notNull()
      .references((): AnyPgColumn => Part.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    entityInstanceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    vendorSku: text().notNull(),
    unitPrice: integer(),
    leadTime: integer(),
    minOrderQty: integer(),
    isPreferred: boolean().default(false).notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex('VendorPart_partId_entityInstanceId_key').using(
      'btree',
      table.partId.asc().nullsLast(),
      table.entityInstanceId.asc().nullsLast()
    ),
  ]
)

export type VendorPartEntity = typeof VendorPart.$inferSelect
