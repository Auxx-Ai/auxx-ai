// packages/database/src/db/models/test-suite.ts
// TestSuite model built on BaseModel (org-scoped)

import { TestSuite } from '../schema/test-suite'
import { BaseModel } from '../utils/base-model'

/** Selected TestSuite entity type */
export type TestSuiteEntity = typeof TestSuite.$inferSelect
/** Insertable TestSuite input type */
export type CreateTestSuiteInput = typeof TestSuite.$inferInsert
/** Updatable TestSuite input type */
export type UpdateTestSuiteInput = Partial<CreateTestSuiteInput>

/**
 * TestSuiteModel encapsulates CRUD for the TestSuite table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class TestSuiteModel extends BaseModel<
  typeof TestSuite,
  CreateTestSuiteInput,
  TestSuiteEntity,
  UpdateTestSuiteInput
> {
  /** Drizzle table */
  get table() {
    return TestSuite
  }
}
