// packages/lib/src/files/assets/index.ts

/**
 * Asset reads and writes written to the `files/` {@link ../ctx.FilesCtx}
 * contract. Explicit named exports only — an implicit surface is how
 * `media-asset-service.ts` reached 1,540 lines.
 */

export type { DownloadDeps, GetAssetDownloadRefOptions } from './download'
export { getAssetDownloadRef } from './download'
