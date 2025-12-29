// packages/database/src/db/models/plan-subscription.ts
// PlanSubscription model built on BaseModel (org-scoped)

import { PlanSubscription } from '../schema/plan-subscription'
import { BaseModel } from '../utils/base-model'

/** Selected PlanSubscription entity type */
export type PlanSubscriptionEntity = typeof PlanSubscription.$inferSelect
/** Insertable PlanSubscription input type */
export type CreatePlanSubscriptionInput = typeof PlanSubscription.$inferInsert
/** Updatable PlanSubscription input type */
export type UpdatePlanSubscriptionInput = Partial<CreatePlanSubscriptionInput>

/**
 * PlanSubscriptionModel encapsulates CRUD for the PlanSubscription table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class PlanSubscriptionModel extends BaseModel<
  typeof PlanSubscription,
  CreatePlanSubscriptionInput,
  PlanSubscriptionEntity,
  UpdatePlanSubscriptionInput
> {
  /** Drizzle table */
  get table() {
    return PlanSubscription
  }
}
