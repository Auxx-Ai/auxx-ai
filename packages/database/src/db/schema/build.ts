// packages/database/src/db/schema/build.ts
// One production run per row. See plans/mrp/23-build-table.md §3.

import { createId } from '@paralleldrive/cuid2'
import { BuildSourceValues, BuildStatusValues } from '../../enums'
import {
  type AnyPgColumn,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  sql,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { User } from './user'

export const buildStatus = pgEnum('BuildStatus', BuildStatusValues)
export const buildSource = pgEnum('BuildSource', BuildSourceValues)

// Each EntityInstance FK column has an index leading with it, because every EntityInstance delete
// runs the FK check against this table.
export const Build = pgTable(
  'Build',
  {
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    createdAt: timestamp({ precision: 3, withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3, withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /** `B-0001`, from the org's `build` RecordSequence. */
    number: text().notNull(),
    /** The part this run produces. No action: the part delete guard refuses while a build names it. */
    partId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, { onUpdate: 'cascade' }),
    status: buildStatus().default('planned').notNull(),
    source: buildSource().default('manual').notNull(),
    /** Null on a reversing build, which plans nothing. */
    quantityPlanned: numeric({ precision: 20, scale: 6, mode: 'number' }),
    /** Negative on a reversing build. */
    quantityProduced: numeric({ precision: 20, scale: 6, mode: 'number' }),
    quantityScrapped: numeric({ precision: 20, scale: 6, mode: 'number' }),
    startedAt: timestamp({ precision: 3, withTimezone: true }),
    /** The accounting date; every movement the build wrote carries it. */
    completedAt: timestamp({ precision: 3, withTimezone: true }),
    postedAt: timestamp({ precision: 3, withTimezone: true }),
    /** Minor units, whole in practice; null until priced. */
    materialCost: numeric({ precision: 20, scale: 3, mode: 'number' }),
    laborCost: numeric({ precision: 20, scale: 3, mode: 'number' }),
    overheadCost: numeric({ precision: 20, scale: 3, mode: 'number' }),
    producedValue: numeric({ precision: 20, scale: 3, mode: 'number' }),
    varianceAmount: numeric({ precision: 20, scale: 3, mode: 'number' }),
    orderId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /** The order's demand fingerprint when an order-raised build was raised. */
    orderRevision: text(),
    /** The demand period a `batch` build claims, half-open. */
    periodStart: timestamp({ precision: 3, withTimezone: true }),
    periodEnd: timestamp({ precision: 3, withTimezone: true }),
    /** The org's `build_batch` sequence number of the batch or backflush run that raised it. */
    batchRun: integer(),
    reversalOfBuildId: text().references((): AnyPgColumn => Build.id, { onUpdate: 'cascade' }),
    notes: text(),
  },
  (table) => [
    uniqueIndex('Build_org_number_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.number.asc().nullsLast()
    ),
    index('Build_org_createdAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.createdAt.desc().nullsFirst()
    ),
    index('Build_org_status_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.status.asc().nullsLast()
    ),
    index('Build_part_completedAt_idx').using(
      'btree',
      table.partId.asc().nullsLast(),
      table.completedAt.asc().nullsLast()
    ),
    index('Build_orderId_idx')
      .using('btree', table.orderId.asc().nullsLast())
      .where(sql`"orderId" IS NOT NULL`),
    index('Build_org_batchRun_idx')
      .using('btree', table.organizationId.asc().nullsLast(), table.batchRun.asc().nullsLast())
      .where(sql`"batchRun" IS NOT NULL`),
    // A build is reversed at most once.
    uniqueIndex('Build_reversalOfBuildId_key')
      .using('btree', table.reversalOfBuildId.asc().nullsLast())
      .where(sql`"reversalOfBuildId" IS NOT NULL`),
  ]
)

export type BuildEntity = typeof Build.$inferSelect
export type CreateBuildRowInput = typeof Build.$inferInsert
