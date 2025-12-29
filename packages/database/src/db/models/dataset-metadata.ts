// packages/database/src/db/models/dataset-metadata.ts
// DatasetMetadata model built on BaseModel (no org scope column)

import { DatasetMetadata } from '../schema/dataset-metadata'
import { BaseModel } from '../utils/base-model'

/** Selected DatasetMetadata entity type */
export type DatasetMetadataEntity = typeof DatasetMetadata.$inferSelect
/** Insertable DatasetMetadata input type */
export type CreateDatasetMetadataInput = typeof DatasetMetadata.$inferInsert
/** Updatable DatasetMetadata input type */
export type UpdateDatasetMetadataInput = Partial<CreateDatasetMetadataInput>

/**
 * DatasetMetadataModel encapsulates CRUD for the DatasetMetadata table.
 * No org scoping is applied by default.
 */
export class DatasetMetadataModel extends BaseModel<
  typeof DatasetMetadata,
  CreateDatasetMetadataInput,
  DatasetMetadataEntity,
  UpdateDatasetMetadataInput
> {
  /** Drizzle table */
  get table() {
    return DatasetMetadata
  }
}
