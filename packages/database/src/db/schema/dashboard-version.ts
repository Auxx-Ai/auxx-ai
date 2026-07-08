// packages/database/src/db/schema/dashboard-version.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'
import { Dashboard } from './dashboard'
import { Organization } from './organization'
import { User } from './user'

/**
 * An immutable, numbered snapshot of a {@link Dashboard}'s layout — the whole
 * page as ONE jsonb doc. Closest to {@link AgentVersion} (every row published,
 * `versionNumber NOT NULL`, `activeVersionId` pointer, `configHash`), minus the
 * server-side draft: the dashboard draft is client-only (plan 06), so unlike
 * `ProcedureVersion`/`ArticleRevision` there is no null-numbered draft row.
 *
 * **Save = publish:** each save inserts version N+1 and repoints
 * `Dashboard.activeVersionId` in one transaction; a publish whose `configHash`
 * matches the active version is a no-op. Rows are append-only, never edited
 * (except `label`) and never deleted in v1. Restore = copy-forward (a new
 * higher-numbered row copying an older layout).
 *
 * See plans/dashboard/01-database-schema.md.
 */
export const DashboardVersion = pgTable(
  'DashboardVersion',
  {
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    dashboardId: text()
      .notNull()
      .references((): AnyPgColumn => Dashboard.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    /**
     * 1..N, append-only. Every row is published (no null-numbered draft —
     * unlike ProcedureVersion/ArticleRevision; the draft is client-side).
     */
    versionNumber: integer().notNull(),
    /** Editable annotation metadata (like AgentVersion.label / renameVersion). */
    label: text(),

    /**
     * THE layout document: `{ tabs: [{ id, title, icon, widgets: [{ id, title,
     * type, gridPosition, configuration }] }], globalFilters? }`. Tabs ordered
     * by array order. Generic jsonb — `@auxx/database` can't see lib's
     * `DashboardLayoutDoc` type (tier rule); lib casts on read, zod-validates
     * on every publish. Same posture as `ProcedureVersion.compiled`.
     */
    layout: jsonb().$type<Record<string, unknown>>().notNull(),

    /**
     * sha256 of the sorted-key-stable-stringified layout doc. Publish with an
     * unchanged hash is a no-op (returns the active version).
     */
    configHash: text().notNull(),

    editorId: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('DashboardVersion_dashboardId_idx').on(table.dashboardId),
    uniqueIndex('DashboardVersion_dashboardId_versionNumber_key').on(
      table.dashboardId,
      table.versionNumber
    ),
  ]
)

export type DashboardVersionEntity = typeof DashboardVersion.$inferSelect
export type DashboardVersionInsert = typeof DashboardVersion.$inferInsert
