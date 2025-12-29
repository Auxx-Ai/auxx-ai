// packages/database/src/db/models/media-asset.ts
// MediaAsset model built on BaseModel (org-scoped)

import { MediaAsset } from '../schema/media-asset'
import { BaseModel } from '../utils/base-model'

/** Selected MediaAsset entity type */
export type MediaAssetEntity = typeof MediaAsset.$inferSelect
/** Insertable MediaAsset input type */
export type CreateMediaAssetInput = typeof MediaAsset.$inferInsert
/** Updatable MediaAsset input type */
export type UpdateMediaAssetInput = Partial<CreateMediaAssetInput>

/**
 * MediaAssetModel encapsulates CRUD for the MediaAsset table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class MediaAssetModel extends BaseModel<
  typeof MediaAsset,
  CreateMediaAssetInput,
  MediaAssetEntity,
  UpdateMediaAssetInput
> {
  /** Drizzle table */
  get table() {
    return MediaAsset
  }
}
