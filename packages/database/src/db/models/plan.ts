// packages/database/src/db/models/plan.ts
// Plan model built on BaseModel (no org scope column)

import { Plan } from '../schema/plan'
import { BaseModel } from '../utils/base-model'

/** Selected Plan entity type */
export type PlanEntity = typeof Plan.$inferSelect
/** Insertable Plan input type */
export type CreatePlanInput = typeof Plan.$inferInsert
/** Updatable Plan input type */
export type UpdatePlanInput = Partial<CreatePlanInput>

/**
 * PlanModel encapsulates CRUD for the Plan table.
 * No org scoping is applied by default.
 */
export class PlanModel extends BaseModel<
  typeof Plan,
  CreatePlanInput,
  PlanEntity,
  UpdatePlanInput
> {
  /** Drizzle table */
  get table() {
    return Plan
  }
}
