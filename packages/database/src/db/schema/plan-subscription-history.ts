// packages/database/src/db/schema/plan-subscription-history.ts
// Drizzle table: PlanSubscriptionHistory - Audit trail for subscription changes

import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  billingCycle,
} from './_shared'
import { createId } from '@paralleldrive/cuid2'

/** Drizzle table for PlanSubscriptionHistory */
export const PlanSubscriptionHistory = pgTable('PlanSubscriptionHistory', {
  id: text()
    .$defaultFn(() => createId())
    .primaryKey()
    .notNull(),
  subscriptionId: text().notNull(),
  organizationId: text().notNull(),
  changeType: text().notNull(), // 'upgrade', 'downgrade', 'cancel', 'restore', 'billing_cycle'
  fromPlan: text(),
  toPlan: text(),
  fromBillingCycle: billingCycle(),
  toBillingCycle: billingCycle(),
  fromSeats: integer(),
  toSeats: integer(),
  immediate: boolean().notNull(),
  scheduledFor: timestamp({ precision: 3 }),
  appliedAt: timestamp({ precision: 3 }),
  prorationAmount: integer(), // in cents
  userId: text().notNull(), // who initiated the change
  createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
})
