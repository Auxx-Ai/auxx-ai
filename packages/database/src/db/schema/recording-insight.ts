// packages/database/src/db/schema/recording-insight.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  index,
  insightStatus,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
} from './_shared'
import { CallRecording } from './call-recording'
import { InsightTemplate } from './insight-template'
import { Organization } from './organization'

export const RecordingInsight = pgTable(
  'RecordingInsight',
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

    callRecordingId: text()
      .notNull()
      .references((): AnyPgColumn => CallRecording.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    insightTemplateId: text()
      .notNull()
      .references((): AnyPgColumn => InsightTemplate.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    status: insightStatus().notNull().default('processing'),

    /** [{ templateSectionId, title, type, values: string[] }] */
    sections: jsonb(),

    createdAt: timestamp({ precision: 3 }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('RecordingInsight_callRecordingId_idx').using(
      'btree',
      table.callRecordingId.asc().nullsLast()
    ),
    index('RecordingInsight_insightTemplateId_idx').using(
      'btree',
      table.insightTemplateId.asc().nullsLast()
    ),
    index('RecordingInsight_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
  ]
)

export type RecordingInsightEntity = typeof RecordingInsight.$inferSelect
export type RecordingInsightInsert = typeof RecordingInsight.$inferInsert
