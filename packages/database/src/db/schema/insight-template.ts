// packages/database/src/db/schema/insight-template.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  index,
  insightTemplateStatus,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
} from './_shared'
import { Organization } from './organization'
import { User } from './user'

export const InsightTemplate = pgTable(
  'InsightTemplate',
  {
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),

    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    /** User-facing name, e.g. "BANT" */
    title: text().notNull(),

    /** AI-generated descriptive title */
    aiTitle: text(),

    status: insightTemplateStatus().notNull().default('enabled'),

    /** [{ title, prompt, type: 'plaintext' | 'list', sortOrder }] */
    sections: jsonb().notNull(),

    /** Auto-apply to all new recordings */
    isDefault: boolean().notNull().default(false),

    /** Lexicographic ordering */
    sortOrder: text().notNull(),

    createdById: text()
      .notNull()
      .references((): AnyPgColumn => User.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    createdAt: timestamp({ precision: 3 }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('InsightTemplate_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    index('InsightTemplate_organizationId_status_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.status.asc().nullsLast()
    ),
  ]
)

export type InsightTemplateEntity = typeof InsightTemplate.$inferSelect
export type InsightTemplateInsert = typeof InsightTemplate.$inferInsert
