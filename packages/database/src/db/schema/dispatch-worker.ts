// packages/database/src/db/schema/dispatch-worker.ts
// A schedulable resource on the dispatch board (plans/dispatch/01-data-model.md §4.2,
// plans/dispatch/07-m2-build.md §A, plans/dispatch/45-teams.md). A worker is either an
// `individual` (a thin per-org gate on a `User`) or a `team` (a crew of other individual
// workers, members linked via `DispatchTeamMember`). Both kinds are one dispatchable board
// row: assignment is worker-based (`WorkOrderVisit.assigneeWorkerId`), a team gets its own
// board color, depot, and route exactly like a person.

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
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
    /** `individual` (backed by a User) | `team` (a crew of member workers, no single User). */
    type: text().notNull().default('individual'),
    /** NULLABLE — teams carry no single user; individuals link their board gate to a User. */
    userId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    /** Team display label. Individuals derive their name from the joined User. */
    name: text(),
    isActive: boolean().default(true).notNull(),
    /** Board column header + chip accent color. */
    color: text(),
    /** ADDRESS_STRUCT-shaped — see the type note above. */
    homeBase: jsonb(),
    /** Route starts at the depot (org business address in v1) — worker Profile switch. */
    routeStartAtHome: boolean().notNull().default(true),
    /** Route ends back at the depot (org business address in v1) — worker Profile switch. */
    routeEndAtHome: boolean().notNull().default(true),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Partial unique — individuals are one-per-user, but multiple team rows carry a null userId.
    uniqueIndex('DispatchWorker_organizationId_userId_key')
      .on(table.organizationId, table.userId)
      .where(sql`${table.userId} IS NOT NULL`),
  ]
)

export type DispatchWorkerEntity = typeof DispatchWorker.$inferSelect
export type DispatchWorkerInsert = typeof DispatchWorker.$inferInsert
