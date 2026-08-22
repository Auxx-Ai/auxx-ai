// packages/lib/src/files/upload/handlers/types.ts

/**
 * What an entity type declares about its uploads.
 *
 * This is the record that replaces the four-level `processConfig` super-chain
 * (`BaseProcessor` → `BaseAssetProcessor` → `BaseAttachmentProcessor` → the ten
 * concrete processors). Today answering "which bucket does an article cover land
 * in?" means reading four `processConfig` implementations across three files,
 * each of which spreads the previous config, mutates a field, and re-freezes it.
 * A handler states the same facts once, as data.
 *
 * ## What is here, and what is deliberately not (PR 4a)
 *
 * PR 4a ships the **config half** of this contract and the declarative records
 * that fill it, because {@link buildUploadConfig} cannot be tested against
 * anything else — a test that invents its own handler literals only proves that
 * the test agrees with itself.
 *
 * Present:
 * - the fields {@link buildUploadConfig} reads (`normalizeInit`, `visibility`,
 *   `maxFileSize`, `allowedMimeTypes`, `maxTtlSec`, `multipartThresholdBytes`),
 * - the plain data the persistence step will need (`entityType`, `assetKind`,
 *   `persist`),
 * - the two hooks that run at the *prepare* boundary (`refineConfig`,
 *   `validateEntity`).
 *
 * Absent, on purpose: `onPersist`, `afterCommit`, and the `PersistResult` they
 * carry. Those describe the persistence path that PR 4d actually builds, and
 * writing their signatures now would be guessing at a shape no caller exists
 * for. PR 4d adds them here.
 *
 * ## Nothing dispatches on this yet
 *
 * The processor chain is still the live path. Until PR 4d converts it,
 * {@link UPLOAD_HANDLERS} and the processors are two statements of the same
 * per-entity numbers, and `handlers/__tests__/handler-parity.test.ts` is the
 * guard that keeps them equal.
 */

import type { AssetKind } from '../../core/types'
import type { FilesCtx } from '../../ctx'
import type { StorageVisibility } from '../../storage/buckets'
import type { EntityType } from '../../types/entities'
import type { UploadInitConfig, UploadPreparedConfig } from '../init-types'
import type { PresignedUploadSession } from '../session-types'

/**
 * Which rows a completed upload turns into.
 *
 * The distinction is not cosmetic: picking the wrong one silently produces the
 * wrong record type. `visit_qc_item` had no registration at all and fell through
 * to a `FolderFile` with no `assetId`, which is the bug `satisfies
 * Record<EntityType, UploadHandler>` on {@link UPLOAD_HANDLERS} makes
 * impossible to reintroduce.
 */
export type PersistStrategy =
  /** `MediaAsset` + version. */
  | 'asset'
  /** …plus an `Attachment` to (`entityType`, `entityId`). */
  | 'asset+attachment'
  /** Find the entity's existing asset of this kind and add a version to it. */
  | 'versioned-asset'
  /** `FolderFile` + `FileVersion`. No `MediaAsset`, no `AssetKind`. */
  | 'folder-file'

/** Everything one entity type declares about its uploads. */
export interface UploadHandler {
  /** The `EntityType` this handler is registered under. */
  entityType: EntityType

  /**
   * Pure rewrite of the incoming request, applied **before** anything else in
   * {@link buildUploadConfig} — so it is visible to the storage key, the
   * visibility function and the policy.
   *
   * Only two entity types need it, and both are rewrites the processors do
   * today: `USER_PROFILE` defaults `entityId` to the uploading user, and
   * `DATASET` copies `entityId` into `metadata.datasetId`. Anything that needs
   * I/O belongs in {@link refineConfig}, not here.
   */
  normalizeInit?: (init: UploadInitConfig) => UploadInitConfig

  /**
   * Which bucket this entity's objects belong in.
   *
   * A function only where the answer genuinely depends on the request — today
   * that is `ARTICLE`, whose covers are forced `PUBLIC` so the resulting CDN URL
   * survives an OG crawler's cache (a presigned URL would 403 by then).
   */
  visibility: StorageVisibility | ((init: UploadInitConfig) => StorageVisibility)

  /** Hard ceiling, in bytes. Becomes the policy's `contentLengthRange` upper bound. */
  maxFileSize: number

  /**
   * The policy's MIME allow-list. `type/subtype`, `type/*` and `*​/*` are all
   * honoured — see `enforceUploadPolicy`.
   */
  allowedMimeTypes: readonly string[]

  /**
   * Ceiling on the presigned signature's lifetime, in seconds, and the policy's
   * `maxTtl`. The requested `ttlSec` is clamped to it, so a prepared config can
   * never fail its own policy's TTL rule.
   */
  maxTtlSec: number

  /**
   * Size at or above which the upload is planned as multipart. Defaults to
   * {@link DEFAULT_MULTIPART_THRESHOLD_BYTES}.
   *
   * Worth stating explicitly per entity: multipart uploads carry **no policy
   * document at all** (`storage/presign.ts`), so raising this threshold is the
   * cheapest way to keep an entity's uploads on the path S3 re-enforces.
   */
  multipartThresholdBytes?: number

  /**
   * The `MediaAsset.kind` this entity's uploads get.
   *
   * Optional because a `folder-file` handler creates no `MediaAsset` and has no
   * kind to declare. The function form exists for the two entity types whose
   * kind depends on the finished session (`ARTICLE` covers become `THUMBNAIL`,
   * temp `MESSAGE` uploads become `TEMP_UPLOAD`); PR 4a populates only the plain
   * values, which is what the processors' `assetKind` field states, and PR 4d
   * moves `getAssetKind`'s logic across.
   */
  assetKind?: AssetKind | ((session: PresignedUploadSession) => AssetKind)

  /** Which rows a completed upload turns into. */
  persist: PersistStrategy

  /**
   * Escape hatch for configuration that needs I/O.
   *
   * Runs **after** {@link buildUploadConfig}, never inside it — the point of
   * `buildUploadConfig` being pure is that the whole policy decision is a table
   * of data, and a hook that can read the database would take that back. Exactly
   * one entity type needs it: `CUSTOM_FIELD` narrows its MIME allow-list from
   * the field's `options.file` in the org cache.
   */
  refineConfig?(
    ctx: FilesCtx,
    config: UploadPreparedConfig,
    init: UploadInitConfig
  ): Promise<UploadPreparedConfig>

  /**
   * Identity and integrity only — **never** a permission check.
   *
   * `packages/lib` performs zero access checks (`docs/lib-module-guide.md` §6);
   * this answers "does this entity exist in this organization", so an upload
   * cannot be aimed at another org's row. Who is allowed to upload is the
   * calling surface's question.
   */
  validateEntity?(ctx: FilesCtx, entityId: string): Promise<void>
}
