// packages/database/src/db/schema/dispatch-worker.ts
// A user's presence as a schedulable resource on the dispatch board (plans/dispatch/01-data-model.md
// §4.2, plans/dispatch/07-m2-build.md §A). One row per org member who can be assigned visits —
// removing the row only ungates the board column; visits keep `assigneeUserId` (assignment stays
// user-based).

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, boolean, jsonb, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { Organization } from './organization'
import { User } from './user'

/** ADDRESS_STRUCT-shaped (`AddressStruct` in `@auxx/lib/custom-fields/types.ts`) — street1/street2/city/state/zipCode/country. */
export const DispatchWorker = pgTable(
  'DispatchWorker',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references((): AnyPgColumn => User.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    isActive: boolean().default(true).notNull(),
    /** Board column header + chip accent color. */
    color: text(),
    /** ADDRESS_STRUCT-shaped — see the type note above. */
    homeBase: jsonb(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('DispatchWorker_organizationId_userId_key').on(table.organizationId, table.userId),
  ]
)

export type DispatchWorkerEntity = typeof DispatchWorker.$inferSelect
export type DispatchWorkerInsert = typeof DispatchWorker.$inferInsert
