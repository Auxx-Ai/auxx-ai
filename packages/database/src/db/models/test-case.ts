// packages/database/src/db/models/test-case.ts
// TestCase model built on BaseModel (org-scoped)

import { TestCase } from '../schema/test-case'
import { BaseModel } from '../utils/base-model'

/** Selected TestCase entity type */
export type TestCaseEntity = typeof TestCase.$inferSelect
/** Insertable TestCase input type */
export type CreateTestCaseInput = typeof TestCase.$inferInsert
/** Updatable TestCase input type */
export type UpdateTestCaseInput = Partial<CreateTestCaseInput>

/**
 * TestCaseModel encapsulates CRUD for the TestCase table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class TestCaseModel extends BaseModel<
  typeof TestCase,
  CreateTestCaseInput,
  TestCaseEntity,
  UpdateTestCaseInput
> {
  /** Drizzle table */
  get table() {
    return TestCase
  }
}
