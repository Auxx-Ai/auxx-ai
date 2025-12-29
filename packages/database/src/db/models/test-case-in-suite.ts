// packages/database/src/db/models/test-case-in-suite.ts
// TestCaseInSuite model built on BaseModel (no org scope column)

import { TestCaseInSuite } from '../schema/test-case-in-suite'
import { BaseModel } from '../utils/base-model'

/** Selected TestCaseInSuite entity type */
export type TestCaseInSuiteEntity = typeof TestCaseInSuite.$inferSelect
/** Insertable TestCaseInSuite input type */
export type CreateTestCaseInSuiteInput = typeof TestCaseInSuite.$inferInsert
/** Updatable TestCaseInSuite input type */
export type UpdateTestCaseInSuiteInput = Partial<CreateTestCaseInSuiteInput>

/**
 * TestCaseInSuiteModel encapsulates CRUD for the TestCaseInSuite table.
 * No org scoping is applied by default.
 */
export class TestCaseInSuiteModel extends BaseModel<
  typeof TestCaseInSuite,
  CreateTestCaseInSuiteInput,
  TestCaseInSuiteEntity,
  UpdateTestCaseInSuiteInput
> {
  /** Drizzle table */
  get table() {
    return TestCaseInSuite
  }
}
