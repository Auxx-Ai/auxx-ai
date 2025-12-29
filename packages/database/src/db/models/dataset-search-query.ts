// packages/database/src/db/models/dataset-search-query.ts
// DatasetSearchQuery model built on BaseModel (org-scoped)

import { DatasetSearchQuery } from '../schema/dataset-search-query'
import { BaseModel } from '../utils/base-model'

/** Selected DatasetSearchQuery entity type */
export type DatasetSearchQueryEntity = typeof DatasetSearchQuery.$inferSelect
/** Insertable DatasetSearchQuery input type */
export type CreateDatasetSearchQueryInput = typeof DatasetSearchQuery.$inferInsert
/** Updatable DatasetSearchQuery input type */
export type UpdateDatasetSearchQueryInput = Partial<CreateDatasetSearchQueryInput>

/**
 * DatasetSearchQueryModel encapsulates CRUD for the DatasetSearchQuery table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class DatasetSearchQueryModel extends BaseModel<
  typeof DatasetSearchQuery,
  CreateDatasetSearchQueryInput,
  DatasetSearchQueryEntity,
  UpdateDatasetSearchQueryInput
> {
  /** Drizzle table */
  get table() {
    return DatasetSearchQuery
  }
}
