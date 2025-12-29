// packages/database/src/db/models/test-result.ts
// TestResult model built on BaseModel (no org scope column)

import { TestResult } from '../schema/test-result'
import { BaseModel } from '../utils/base-model'

/** Selected TestResult entity type */
export type TestResultEntity = typeof TestResult.$inferSelect
/** Insertable TestResult input type */
export type CreateTestResultInput = typeof TestResult.$inferInsert
/** Updatable TestResult input type */
export type UpdateTestResultInput = Partial<CreateTestResultInput>

/**
 * TestResultModel encapsulates CRUD for the TestResult table.
 * No org scoping is applied by default.
 */
export class TestResultModel extends BaseModel<
  typeof TestResult,
  CreateTestResultInput,
  TestResultEntity,
  UpdateTestResultInput
> {
  /** Drizzle table */
  get table() {
    return TestResult
  }
}
