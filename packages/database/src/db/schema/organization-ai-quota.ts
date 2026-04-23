// packages/database/src/db/schema/organization-ai-quota.ts
// Drizzle table: organizationAiQuota — org-level AI credit pool.

import { type AnyPgColumn, integer, pgTable, text, timestamp } from './_shared'

import { Organization } from './organization'

/**
 * OrganizationAiQuota — the single source of truth for an organization's
 * monthly AI credit pool. Replaces the per-ProviderConfiguration quota columns.
 *
 * - `quotaLimit` is the monthly allowance set from the active plan's `monthlyAiCredits`.
 *   `-1` means unlimited (enterprise / self-hosted).
 * - `quotaUsed` is monotonically incremented by LLM calls × model multiplier.
 * - `quotaPeriod*` defines the current cycle; reset by the daily cron and
 *   Stripe `invoice.paid` webhook.
 */
export const OrganizationAiQuota = pgTable('OrganizationAiQuota', {
  organizationId: text()
    .primaryKey()
    .references((): AnyPgColumn => Organization.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
  quotaType: text().notNull(),
  quotaLimit: integer().notNull(),
  quotaUsed: integer().default(0).notNull(),
  quotaPeriodStart: timestamp({ precision: 3 }).defaultNow().notNull(),
  quotaPeriodEnd: timestamp({ precision: 3 }).notNull(),
  createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  updatedAt: timestamp({ precision: 3 })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
})

export type OrganizationAiQuotaEntity = typeof OrganizationAiQuota.$inferSelect
