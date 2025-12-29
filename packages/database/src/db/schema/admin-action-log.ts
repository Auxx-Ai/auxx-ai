// packages/database/src/db/schema/admin-action-log.ts
// Drizzle table: adminActionLog

import { pgTable, index, text, timestamp, jsonb, type AnyPgColumn } from './_shared'
import { createId } from '@paralleldrive/cuid2'

import { User } from './user'
import { Organization } from './organization'

/** Drizzle table for adminActionLog - tracks all admin actions for audit purposes */
export const AdminActionLog = pgTable(
  'AdminActionLog',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    adminUserId: text()
      .notNull()
      .references((): AnyPgColumn => User.id, { onDelete: 'cascade' }),
    actionType: text().notNull(), // 'END_TRIAL', 'EXTEND_TRIAL', 'SET_ENTERPRISE', 'CONFIGURE_LIMITS', etc.
    targetType: text().notNull(), // 'ORGANIZATION', 'SUBSCRIPTION', 'INVOICE', etc.
    targetId: text().notNull(),
    organizationId: text().references((): AnyPgColumn => Organization.id, {
      onDelete: 'cascade',
    }),
    details: jsonb(), // Additional context about the action
    reason: text(), // Admin-provided reason for the action
    previousState: jsonb(), // State before change (for rollback/audit)
    newState: jsonb(), // State after change
    ipAddress: text(), // Admin's IP address
    userAgent: text(), // Admin's user agent
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('AdminActionLog_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
    index('AdminActionLog_adminUserId_idx').using('btree', table.adminUserId.asc().nullsLast()),
    index('AdminActionLog_createdAt_idx').using('btree', table.createdAt.desc().nullsLast()),
    index('AdminActionLog_actionType_idx').using('btree', table.actionType.asc().nullsLast()),
  ]
)
