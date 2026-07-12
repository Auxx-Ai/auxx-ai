// packages/database/src/db/schema/visit-qc-item.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, boolean, index, integer, pgTable, text, timestamp } from './_shared'
import { Organization } from './organization'
import { QcItemTemplate } from './qc-item-template'
import { User } from './user'
import { WorkOrderVisit } from './work-order-visit'

/**
 * One quality-check row on a worker's visit (08-worker-surface.md §5) — lazily materialized
 * (copied) from the org's ACTIVE `QcItemTemplate` rows the first time the visit's checklist is
 * read. `title`/`isRequired` are SNAPSHOT columns: once copied they never change even if the
 * source template is edited or deactivated later — only future visits see the new values.
 * `templateId` null = an ad-hoc row a worker added on the spot (no source template).
 */
export const VisitQcItem = pgTable(
  'VisitQcItem',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    visitId: text()
      .notNull()
      .references((): AnyPgColumn => WorkOrderVisit.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    /** null = ad-hoc row (no source template) */
    templateId: text().references((): AnyPgColumn => QcItemTemplate.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /** SNAPSHOT — copied from the template at materialization time, never rewritten by template edits */
    title: text().notNull(),
    /** SNAPSHOT — see `title` */
    isRequired: boolean().default(false).notNull(),
    note: text(),
    checkedAt: timestamp({ precision: 3, withTimezone: true }),
    checkedByUserId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    sortOrder: integer().default(0).notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('VisitQcItem_visitId_idx').using('btree', table.visitId.asc().nullsLast())]
)

export type VisitQcItemEntity = typeof VisitQcItem.$inferSelect
export type VisitQcItemInsert = typeof VisitQcItem.$inferInsert
