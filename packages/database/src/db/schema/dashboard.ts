// packages/database/src/db/schema/dashboard.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
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
 * Modeled directly on {@link Agent}: the **row is the draft** ({@link draftLayout}),
 * `activeVersionId` points at the published {@link DashboardVersion}, and
 * `hasUnpublishedChanges` flags divergence — there is no `draftVersionId`.
 *
 * **Versioning model (agent parity):** edits auto-save to `draftLayout` (no new
 * version). Viewers render the ACTIVE version; editors render the draft.
 * **Publish** snapshots `draftLayout` into a new immutable {@link DashboardVersion}
 * (versionNumber N+1), repoints `activeVersionId`, and clears
 * `hasUnpublishedChanges` — see plans/dashboard/02-backend-layout-api.md. A publish
 * whose `configHash` matches the active version is a no-op. **Discard** copies the
 * active version's layout back onto `draftLayout`. **Restore** loads an older
 * version onto `draftLayout` (review, then publish) — it does NOT go live directly.
 *
 * **Not stored here:** no `globalFilters` column — global-filter *defaults* are
 * content, versioned inside the layout doc; the viewer's ephemeral picks are URL
 * state (plan 08).
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
     * Pointer into {@link DashboardVersion} — what viewers render. Set on create
     * (v1) and repointed on every publish; never null after create. Plain text
     * (no FK) to avoid the circular reference, same as `Agent.activeVersionId`;
     * the service layer owns integrity.
     */
    activeVersionId: text(),

    /**
     * THE live editable draft — the whole layout doc as ONE jsonb blob (same
     * shape as {@link DashboardVersion.layout}). The Dashboard row IS the draft,
     * exactly like `Agent`'s behavior fields. Edits auto-save here; publish
     * snapshots it into a version. Nullable for forward-compat; readers fall back
     * to the active version's layout when null. Generic jsonb — `@auxx/database`
     * can't see lib's `DashboardLayoutDoc` type (tier rule); lib validates on
     * every write (a permissive draft schema that tolerates unconfigured widgets).
     */
    draftLayout: jsonb().$type<Record<string, unknown>>(),

    /**
     * True when `draftLayout` has diverged from the active {@link DashboardVersion}
     * (hash-compared on every draft write). Drives the "Live · unsaved" pill and
     * the Publish/Discard controls. Cleared on publish and discard. Mirrors
     * `Agent.hasUnpublishedChanges`.
     */
    hasUnpublishedChanges: boolean().notNull().default(false),

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
