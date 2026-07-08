// packages/database/src/db/schema/dashboard.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  sql,
  text,
  timestamp,
} from './_shared'
import { Organization } from './organization'
import { User } from './user'

/**
 * A customizable, multi-tab, versioned dashboard — the identity + access record.
 * Modeled on {@link Agent} (a pointer-to-active-version row), but WITHOUT the
 * row-as-draft: the entire editable layout lives in a client-only draft store
 * (see plans/dashboard/06-state-and-save.md); this row carries no layout at all.
 *
 * **Versioning model:** every save is a publish. The client draft is validated,
 * a new immutable {@link DashboardVersion} (versionNumber N+1) is inserted, and
 * `activeVersionId` is repointed in the same transaction — see
 * plans/dashboard/02-backend-layout-api.md. Viewers always render the active
 * version. A publish whose `configHash` matches the active version is a no-op.
 * Restore is copy-forward (restoring v3 inserts v6 as a copy) — history is
 * linear and append-only.
 *
 * **Not stored here:** no layout column (layout lives only in versions) and no
 * globalFilters column — global-filter *defaults* are content, versioned inside
 * the layout doc; the viewer's ephemeral picks are URL state (plan 08).
 *
 * See plans/dashboard/01-database-schema.md.
 */
export const Dashboard = pgTable(
  'Dashboard',
  {
    id: text()
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    createdAt: timestamp({ precision: 3 }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp({ precision: 3 })
      .notNull()
      .$onUpdate(() => new Date()),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    name: text().notNull(),
    description: text(),
    /**
     * House icon shape (same as WorkflowTemplate/PromptTemplate): `{ iconId,
     * color }`. Null → renderer default (LayoutDashboard / blue).
     */
    icon: jsonb().$type<{ iconId: string; color: string }>(),

    /**
     * Pointer into {@link DashboardVersion} — what viewers render. Set in the
     * same transaction as every publish (create/save/restore); never null after
     * create. Plain text (no FK) to avoid the circular reference, same as
     * `Agent.activeVersionId`; the service layer owns integrity.
     */
    activeVersionId: text(),

    /** Owner. 'set null' — dashboards outlive their creator. */
    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    /** 'private' (owner only) | 'org' (all members view + edit) */
    visibility: text().notNull().default('org'),
    /** Ordering in the dashboards list / future sidebar pinning */
    position: doublePrecision().notNull().default(0),

    archivedAt: timestamp({ precision: 3 }),
  },
  (table) => [
    index('Dashboard_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('Dashboard_createdById_idx').using('btree', table.createdById.asc().nullsLast()),
    index('Dashboard_archivedAt_idx').using('btree', table.archivedAt.asc().nullsLast()),
  ]
)

export type DashboardEntity = typeof Dashboard.$inferSelect
export type DashboardInsert = typeof Dashboard.$inferInsert
