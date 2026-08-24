// packages/lib/src/files/assets/index.ts

/**
 * Asset reads and writes written to the `files/` {@link ../ctx.FilesCtx}
 * contract. Explicit named exports only — an implicit surface is how
 * `media-asset-service.ts` reached 1,540 lines.
 */

export type {
  CreateAssetFromFolderFileInput,
  CreateAssetInput,
  CreateAssetWithVersionInput,
  UpdateAssetInput,
} from './asset-mutations'
export {
  convertTempAssetToPermanent,
  createAsset,
  createAssetFromFolderFile,
  createAssetWithVersion,
  deleteAsset,
  updateAsset,
} from './asset-mutations'
export type {
  AssetPage,
  AssetVersionWithLocation,
  ListAssetsOptions,
} from './asset-queries'
export {
  findAssetsByKind,
  findExpiredAssets,
  getAsset,
  getAssetCurrentVersion,
  getAssetVersionByNumber,
  getAssetVersions,
  getAssetWithRelations,
  getLatestAssetVersion,
  listAssets,
  loadCurrentVersion,
  requireAsset,
} from './asset-queries'
export type {
  AssetVersionSelector,
  DownloadDeps,
  GetAssetDownloadRefOptions,
  VersionWithLocation,
} from './download'
export { getAssetDownloadRef, resolveAssetDownloadRef } from './download'
export type {
  AssetDeleteDeps,
  AssetVersionDeleteDeps,
  AssetWriteDeps,
  ThumbnailCleanupPort,
} from './ports'
export type {
  CreateAssetVersionInput,
  CreatedAssetVersion,
  UpdateAssetContentInput,
} from './version-mutations'
export {
  createAssetVersion,
  deleteAssetVersion,
  restoreAssetVersion,
  updateAssetContent,
} from './version-mutations'
