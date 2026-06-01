// packages/database/src/db/schema/audit-log.ts
// Drizzle table: AuditLog — system-wide, immutable, append-only audit/security log.
// Distinct from TimelineEvent (per-entity activity) and AppEventLog (app execution).
// Written via two paths: direct writes at the request layer (with IP/UA) and a
// bus-projection handler. See plans/log/01-implementation-plan.md.

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, jsonb, pgTable, text, timestamp } from './_shared'
import { Organization } from './organization'

/** Immutable audit/security log. Rows are INSERT-only; nothing updates or deletes them. */
export const AuditLog = pgTable(
  'AuditLog',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    // Nullable: NULL = platform-level event (visible to super-admins only).
    organizationId: text().references((): AnyPgColumn => Organization.id, {
      onDelete: 'cascade',
    }),
    // What — kept as plain text (not pgEnum) so new categories/actions need no migration.
    category: text().notNull(), // 'auth' | 'members' | 'settings' | 'billing' | 'integrations' | 'apps' | 'data_export' | 'security'
    action: text().notNull(), // 'member.removed', 'apiKey.revoked', 'data.exported', ...
    targetType: text(), // 'User' | 'Subscription' | 'Integration' | ...
    targetId: text(),
    // Who / how / where. actorId is intentionally NOT a User FK — actors may be
    // 'system', 'api', or an integration, not just a user.
    actorType: text().notNull(), // 'user' | 'system' | 'api' | 'integration' | 'admin'
    actorId: text(),
    ipAddress: text(),
    userAgent: text(),
    sessionId: text(),
    // Detail
    reason: text(),
    previousState: jsonb(),
    newState: jsonb(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    // Lens control: 'admin' = customer-visible activity feed; 'internal' = super-admin only.
    visibility: text().notNull().default('admin'),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    // No updatedAt / deletedAt by design — append-only and immutable.
  },
  (table) => [
    index('AuditLog_org_createdAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.createdAt.desc().nullsLast()
    ),
    index('AuditLog_org_category_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.category.asc().nullsLast()
    ),
    index('AuditLog_org_visibility_createdAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.visibility.asc().nullsLast(),
      table.createdAt.desc().nullsLast()
    ),
    index('AuditLog_actorId_idx').using('btree', table.actorId.asc().nullsLast()),
    index('AuditLog_target_idx').using(
      'btree',
      table.targetType.asc().nullsLast(),
      table.targetId.asc().nullsLast()
    ),
    index('AuditLog_createdAt_idx').using('btree', table.createdAt.desc().nullsLast()),
  ]
)

/** A persisted audit-log row. */
export type AuditLogEntity = typeof AuditLog.$inferSelect
