// packages/database/src/db/models/dataset-search-result.ts
// DatasetSearchResult model built on BaseModel (no org scope column)

import { DatasetSearchResult } from '../schema/dataset-search-result'
import { BaseModel } from '../utils/base-model'

/** Selected DatasetSearchResult entity type */
export type DatasetSearchResultEntity = typeof DatasetSearchResult.$inferSelect
/** Insertable DatasetSearchResult input type */
export type CreateDatasetSearchResultInput = typeof DatasetSearchResult.$inferInsert
/** Updatable DatasetSearchResult input type */
export type UpdateDatasetSearchResultInput = Partial<CreateDatasetSearchResultInput>

/**
 * DatasetSearchResultModel encapsulates CRUD for the DatasetSearchResult table.
 * No org scoping is applied by default.
 */
export class DatasetSearchResultModel extends BaseModel<
  typeof DatasetSearchResult,
  CreateDatasetSearchResultInput,
  DatasetSearchResultEntity,
  UpdateDatasetSearchResultInput
> {
  /** Drizzle table */
  get table() {
    return DatasetSearchResult
  }
}
