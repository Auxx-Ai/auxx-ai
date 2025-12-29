// packages/database/src/db/models/test-run.ts
// TestRun model built on BaseModel (org-scoped)

import { TestRun } from '../schema/test-run'
import { BaseModel } from '../utils/base-model'

/** Selected TestRun entity type */
export type TestRunEntity = typeof TestRun.$inferSelect
/** Insertable TestRun input type */
export type CreateTestRunInput = typeof TestRun.$inferInsert
/** Updatable TestRun input type */
export type UpdateTestRunInput = Partial<CreateTestRunInput>

/**
 * TestRunModel encapsulates CRUD for the TestRun table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class TestRunModel extends BaseModel<
  typeof TestRun,
  CreateTestRunInput,
  TestRunEntity,
  UpdateTestRunInput
> {
  /** Drizzle table */
  get table() {
    return TestRun
  }
}
