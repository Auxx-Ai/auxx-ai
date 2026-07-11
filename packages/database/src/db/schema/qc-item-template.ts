// packages/database/src/db/schema/qc-item-template.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, boolean, index, integer, pgTable, text, timestamp } from './_shared'
import { Organization } from './organization'

/**
 * An org-level quality-check catalog entry (plans/dispatch/08-worker-surface.md §5) — the
 * admin-managed template a worker's per-visit checklist is materialized from. Deactivate-not-
 * delete: `isActive` only gates whether the template is copied onto NEW `VisitQcItem` snapshots;
 * template edits never rewrite past visits (see `VisitQcItem`'s own snapshot columns).
 */
export const QcItemTemplate = pgTable(
  'QcItemTemplate',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    title: text().notNull(),
    description: text(),
    isRequired: boolean().default(false).notNull(),
    sortOrder: integer().default(0).notNull(),
    isActive: boolean().default(true).notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('QcItemTemplate_organizationId_isActive_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.isActive.asc().nullsLast()
    ),
  ]
)

export type QcItemTemplateEntity = typeof QcItemTemplate.$inferSelect
export type QcItemTemplateInsert = typeof QcItemTemplate.$inferInsert
