// packages/database/src/db/models/operating-hours.ts
// OperatingHours model built on BaseModel (no org scope column)

import { OperatingHours } from '../schema/operating-hours'
import { BaseModel } from '../utils/base-model'

/** Selected OperatingHours entity type */
export type OperatingHoursEntity = typeof OperatingHours.$inferSelect
/** Insertable OperatingHours input type */
export type CreateOperatingHoursInput = typeof OperatingHours.$inferInsert
/** Updatable OperatingHours input type */
export type UpdateOperatingHoursInput = Partial<CreateOperatingHoursInput>

/**
 * OperatingHoursModel encapsulates CRUD for the OperatingHours table.
 * No org scoping is applied by default.
 */
export class OperatingHoursModel extends BaseModel<
  typeof OperatingHours,
  CreateOperatingHoursInput,
  OperatingHoursEntity,
  UpdateOperatingHoursInput
> {
  /** Drizzle table */
  get table() {
    return OperatingHours
  }
}
