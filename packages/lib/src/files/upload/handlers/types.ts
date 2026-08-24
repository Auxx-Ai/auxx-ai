// packages/lib/src/files/upload/handlers/types.ts

/**
 * What an entity type declares about its uploads.
 *
 * This is the record that replaced the four-level `processConfig` super-chain
 * (`BaseProcessor` → `BaseAssetProcessor` → `BaseAttachmentProcessor` → the ten
 * concrete processors). Answering "which bucket does an article cover land in?"
 * used to mean reading four `processConfig` implementations across three files,
 * each of which spread the previous config, mutated a field, and re-froze it. A
 * handler states the same facts once, as data.
 *
 * ## The three halves, and where each one runs
 *
 * 1. **Declarative** — `visibility`, `maxFileSize`, `allowedMimeTypes`,
 *    `maxTtlSec`, `multipartThresholdBytes`, `assetKind`, `persist`. Read by the
 *    pure {@link buildUploadConfig}. No I/O, ever.
 * 2. **Prepare-time hooks** — {@link UploadHandler.normalizeInit} (pure),
 *    {@link UploadHandler.validateEntity} and
 *    {@link UploadHandler.refineConfig} (both may read). These run in
 *    `prepareUpload`, before a byte has been written.
 * 3. **Completion hooks** — {@link UploadHandler.assetExpiresAt} (pure),
 *    {@link UploadHandler.onPersist} (inside the one transaction) and
 *    {@link UploadHandler.afterCommit} (strictly after `COMMIT`). The boundary
 *    between the last two is not stylistic: an enqueue issued before `COMMIT`
 *    resolves its source on a different connection and cannot see the rows the
 *    open transaction has written (Tier-1 §1.3).
 *
 * ## What a handler is NOT allowed to be
 *
 * A permission check. `packages/lib` performs zero access checks
 * (`docs/lib-module-guide.md` §6) — see {@link UploadHandler.validateEntity}.
 */

import type { Transaction } from '@auxx/database'
import type { AssetKind } from '../../core/types'
import type { FilesCtx, FilesDeps } from '../../ctx'
import type { StorageVisibility } from '../../storage/buckets'
import type { PresetKey, ThumbnailOptions } from '../../thumbnails/presets'
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

/**
 * The rows one completed upload produced.
 *
 * A superset of the old `ProcessorResult` union, flattened. The union claimed
 * `fileId` and `assetId` were mutually exclusive — which is true — but every
 * consumer immediately widened it back out, and the exclusivity is already
 * guaranteed structurally by {@link PersistStrategy}.
 */
export interface PersistResult {
  /** Always present: the `StorageLocation` row the bytes are recorded at. */
  storageLocationId: string
  /** Present for every strategy except `folder-file`. */
  assetId?: string
  /** Present only for `folder-file`. */
  fileId?: string
  /** Present only for `asset+attachment`. */
  attachmentId?: string
  /** Present only where an {@link UploadHandler.onPersist} produced one. */
  documentId?: string
  /**
   * The stored object's durable public URL, or `''` for a PRIVATE upload.
   *
   * Read straight off the `StorageLocation` row rather than recomputed, so the
   * URL an `onPersist` writes into `KnowledgeBase.logoLight` is byte-identical
   * to the one the location records.
   */
  externalUrl: string
}

/** What {@link UploadHandler.onPersist} may touch: the clock, and the caller's `tx`. */
export type UploadPersistDeps = Pick<FilesDeps, 'now'>

/**
 * What {@link UploadHandler.afterCommit} may touch.
 *
 * No `db` beyond `ctx`. `cache` arrived in PR 6c along with
 * `createProductionCachePort()`; before it, `USER_PROFILE` and `CHAT_WIDGET`
 * busted through `await import('../../../cache')`, which is invisible to the
 * journal the ordering test reads — so the one property the ports exist to prove
 * was not being proved for the only two calls that had ever broken it.
 */
export type UploadAfterCommitDeps = Pick<FilesDeps, 'storage' | 'queue' | 'cache' | 'now'>

/**
 * The derived renditions an entity type's uploads produce, enqueued **after**
 * the upload transaction commits.
 *
 * One record rather than three loose fields, because the three answers only
 * make sense together: which presets, which of them writes back to `User`, and
 * which one the response prefers as a preview.
 */
export interface UploadThumbnailSpec {
  /** Presets to ensure. Answered in this order. */
  presets: readonly PresetKey[]
  /**
   * Per-preset overrides, merged over the shared `{ visibility: 'PUBLIC' }`.
   *
   * Exactly one preset may carry `updateUser: true` — the worker honours it for
   * whichever preset asks, and two askers would mean two jobs racing to write
   * one column.
   */
  perPreset?: Partial<Record<PresetKey, Partial<ThumbnailOptions>>>
  /**
   * Prefer this preset's asset for the response's preview URL when the fan-out
   * reports it already generated. Absent means "always preview the original".
   */
  preview?: PresetKey
}

/** Everything one entity type declares about its uploads. */
export interface UploadHandler {
  /** The `EntityType` this handler is registered under. */
  entityType: EntityType

  /**
   * Pure rewrite of the incoming request, applied **before** anything else in
   * {@link buildUploadConfig} — so it is visible to the storage key, the
   * visibility function and the policy.
   *
   * Only two entity types need it, and both are rewrites the processors did:
   * `USER_PROFILE` defaults `entityId` to the uploading user, and `DATASET`
   * copies `entityId` into `metadata.datasetId`. Anything that needs I/O
   * belongs in {@link refineConfig}, not here.
   *
   * It must be **idempotent**: `prepareUpload` normalizes once to decide what to
   * validate, and `buildUploadConfig` normalizes again inside its own pipeline.
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
   * kind to declare. The function form exists for the entity types whose kind
   * depends on the finished session — `ARTICLE` covers become `THUMBNAIL`,
   * temporary and inline `MESSAGE` uploads become `TEMP_UPLOAD` and
   * `INLINE_IMAGE`.
   */
  assetKind?: AssetKind | ((session: PresignedUploadSession) => AssetKind)

  /** Which rows a completed upload turns into. */
  persist: PersistStrategy

  /**
   * When this upload's asset is temporary, the deadline the cleanup sweep reads.
   *
   * Pure, and stamped **at insert time** rather than by a follow-up `UPDATE`.
   * The processors created the asset and then immediately re-`UPDATE`d it to
   * `kind: 'TEMP_UPLOAD', expiresAt`; the row they ended up with is the row this
   * produces in one statement.
   */
  assetExpiresAt?(session: PresignedUploadSession, now: () => Date): Date | undefined

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
   * cannot be aimed at another org's row. Who is *allowed* to upload is the
   * calling surface's question, and `sessions/route.ts` is where it is asked.
   *
   * Takes the whole normalized request rather than a bare `entityId` because
   * `USER_PROFILE`'s identity question is about the *pair* — is the target the
   * uploader, or an agent's synthetic user in the same organization.
   *
   * Not called when the request carries no `entityId`, mirroring
   * `BaseAssetProcessor`'s `if (init.entityId)` guard.
   */
  validateEntity?(ctx: FilesCtx, init: UploadInitConfig): Promise<void>

  /**
   * Extra writes in the SAME transaction as the asset.
   *
   * Runs on `tx`, so everything it writes commits or rolls back with the asset.
   * **No queue write, no cache bust, no storage call belongs here** — see
   * {@link afterCommit}.
   *
   * Whatever it returns is merged into the {@link PersistResult}, which is how
   * `DATASET` reports the `Document` it created without the persistence step
   * knowing datasets exist.
   */
  onPersist?(
    tx: Transaction,
    ctx: FilesCtx,
    deps: UploadPersistDeps,
    result: PersistResult,
    session: PresignedUploadSession
  ): Promise<Partial<PersistResult> | undefined>

  /**
   * Work that must happen only once the rows are durable: queue writes, cache
   * busts, anything that resolves its own source on another connection.
   *
   * Called by `runUploadPostCommit` after `db.transaction` has resolved, inside
   * a `try/catch` — by then the bytes are in storage and the rows are committed,
   * so a failure here must never turn a durable upload into a 500.
   */
  afterCommit?(
    ctx: FilesCtx,
    deps: UploadAfterCommitDeps,
    result: PersistResult,
    session: PresignedUploadSession
  ): Promise<void>

  /** Derived renditions to enqueue after `COMMIT`. Absent means none. */
  thumbnails?: UploadThumbnailSpec
}
