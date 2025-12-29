// packages/database/src/db/models/media-asset-version.ts
// MediaAssetVersion model built on BaseModel (no org scope column)

import { MediaAssetVersion } from '../schema/media-asset-version'
import { BaseModel } from '../utils/base-model'

/** Selected MediaAssetVersion entity type */
export type MediaAssetVersionEntity = typeof MediaAssetVersion.$inferSelect
/** Insertable MediaAssetVersion input type */
export type CreateMediaAssetVersionInput = typeof MediaAssetVersion.$inferInsert
/** Updatable MediaAssetVersion input type */
export type UpdateMediaAssetVersionInput = Partial<CreateMediaAssetVersionInput>

/**
 * MediaAssetVersionModel encapsulates CRUD for the MediaAssetVersion table.
 * No org scoping is applied by default.
 */
export class MediaAssetVersionModel extends BaseModel<
  typeof MediaAssetVersion,
  CreateMediaAssetVersionInput,
  MediaAssetVersionEntity,
  UpdateMediaAssetVersionInput
> {
  /** Drizzle table */
  get table() {
    return MediaAssetVersion
  }
}
