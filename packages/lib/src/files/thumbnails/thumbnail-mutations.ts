// packages/lib/src/files/thumbnails/thumbnail-mutations.ts

/**
 * Thumbnail writes: ensure one exists, and drop the ones derived from a source.
 *
 * Reads live in `thumbnails/thumbnail-queries.ts`; the scheduled sweeps live in
 * `thumbnails/cleanup.ts`, which this file reuses rather than reimplements.
 *
 * ## The one function that replaced two
 *
 * `ThumbnailService.ensureThumbnail` and `thumbnail-enqueue.ts`'s
 * `enqueueEnsureThumbnail` were two implementations of *check the database, then
 * enqueue*: one on a service bound to the global `db`, one standalone on the
 * global `db`. They disagreed about the job key, about whether a deterministic
 * job id was set, about whether a Redis latch was taken, about
 * `attempts`/`backoff`, about whether an unknown preset was a `TypeError` or an
 * `Error`, and — the one that mattered — about whether a `PROCESSING` placeholder
 * counts as `ready`. {@link ensureThumbnail} is the single survivor.
 *
 * ## `db` arrives through `ctx`, and that is the whole point
 *
 * The legacy service bound `dbClient = db` at construction. That is exactly the
 * Tier-1 §1.3 bug: `ensureThumbnailPresets` built a service on the app pool and
 * the upload processors called it from *inside* an open transaction, so the
 * enqueue resolved its source on a connection that could not see the uncommitted
 * rows — a first upload threw `Asset not found` and a re-upload happily returned
 * the *previous* image's thumbnail as `ready`. With `db` in `ctx` a caller
 * cannot make that mistake silently; it has to pass the pool on purpose.
 *
 * The repo-wide rule still stands and is not fixed by this signature: **enqueue
 * after `COMMIT`, never from inside a processor.** `complete/route.ts` phase 3
 * is the one sanctioned enqueue site for uploads.
 *
 * ## There is no synchronous branch any more
 *
 * `ThumbnailService.generateNow` / `generateWithPlaceholder` (≈165 lines) had
 * exactly one caller in the repo — its own unit test — and reimplemented
 * `jobs/maintenance/generate-thumbnail-job.ts` a second time: download, normalize,
 * `processImage`, upload, create asset + version. Two copies of an image pipeline
 * with one live consumer is a liability, so the dead copy is gone rather than
 * ported. `opts.queue === false` no longer has a meaning; the option is kept on
 * the payload type only because persisted BullMQ jobs still carry it.
 */

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { AuxxError as AuxxErrorClass, NotFoundError } from '../../errors'
import type { ThumbnailCleanupPort } from '../assets/ports'
import type { FilesCtx, FilesDeps } from '../ctx'
import { processThumbnailDeletions } from './cleanup'
import { guard } from './guard'
import type { PresetKey, ThumbnailOptions, ThumbnailResult, ThumbnailSource } from './presets'
import { assertPresetKey, DEFAULT_PRESET, thumbnailJobKey } from './presets'
import type {
  AttachmentThumbnailSource,
  FileVersionForConversion,
  ResolvedThumbnailSource,
} from './thumbnail-queries'
import {
  findConvertedAssetForLocation,
  loadAssetSource,
  loadAttachmentSource,
  loadThumbnail,
  loadThumbnailsForSource,
} from './thumbnail-queries'

/**
 * What an enqueue needs: the queue, and a clock for the `updatedAt` stamp on a
 * `FILE_CONVERSION` asset an attachment source may have to mint.
 *
 * A narrowed slice, not the bundle — `files/ctx.ts`. Notably it has **no
 * `storage`**: enqueuing a thumbnail cannot touch S3, and the signature says so.
 */
export type ThumbnailEnqueueDeps = Pick<FilesDeps, 'queue' | 'now'>

/** What a delete needs: storage to drop the objects, and a clock to stamp `deletedAt`. */
export type ThumbnailDeleteDeps = Pick<FilesDeps, 'storage' | 'now'>

/**
 * One thumbnail request.
 *
 * `createdById` is in the input rather than in `ctx` because `FilesCtx`
 * deliberately carries no actor (`files/ctx.ts`): attribution appears in the
 * signature of exactly the functions that attribute. It lands on the job payload
 * and on any `FILE_CONVERSION` asset the resolution mints.
 */
export interface EnsureThumbnailInput {
  source: ThumbnailSource
  /** Actor recorded on the job payload and on any asset this creates. */
  createdById: string
  /** Preset, format/quality overrides, visibility. Defaults to `avatar-64`. */
  opts?: ThumbnailOptions
}

/** One entry of {@link ensureThumbnailPresets}' answer, in preset order. */
export interface ThumbnailPresetResult {
  preset: PresetKey
  status: 'queued' | 'ready'
  /** Present for `queued`. */
  jobId?: string
  /**
   * Present for `ready`. A caller that needs the public URL of a thumbnail which
   * already existed has no job to wait on and no other way to find it — dropping
   * these is what let an already-thumbnailed avatar strand on
   * `EntityInstance.avatarUrl = null` forever.
   */
  assetId?: string
  assetVersionId?: string
  storageLocationId?: string
}

/** Fan-out request for {@link ensureThumbnailPresets}. */
export interface EnsureThumbnailPresetsInput {
  source: ThumbnailSource
  createdById: string
  /** Presets to ensure. The answer comes back in this order. */
  presets: readonly PresetKey[]
  /** Applied to every preset. Defaults to `{ visibility: 'PUBLIC' }`. */
  defaultOptions?: Omit<ThumbnailOptions, 'preset'>
  /** Per-preset overrides, merged over `defaultOptions`. */
  perPreset?: Partial<Record<PresetKey, Partial<ThumbnailOptions>>>
}

/**
 * Make sure a thumbnail exists for a source, enqueuing its generation if not.
 *
 * Answers `ready` only when a live thumbnail row **has a storage location** —
 * which is the bug fix worth naming. The legacy service returned
 * `{ status: 'ready', storageLocationId: existing.storageLocationId! }` for any
 * live row, and a row in `status: 'PROCESSING'` has no location yet, so a
 * placeholder left behind by a crashed worker made every subsequent request
 * answer `ready` with `storageLocationId: undefined` — and no new job was ever
 * enqueued, so the preset stayed broken until the 24-hour failed-thumbnail sweep
 * removed the placeholder. `enqueueEnsureThumbnail` got this right; that is the
 * behaviour kept here. A placeholder now falls through to a re-enqueue, which is
 * also the recovery.
 *
 * @param ctx Scope and database. **Pass the connection the caller is actually
 *   on.** A `ctx` holding the pool while the caller sits inside an open
 *   transaction is Tier-1 §1.3 all over again.
 * @param deps Queue and clock — see {@link ThumbnailEnqueueDeps}.
 * @param input Source, actor, and preset options.
 * @returns `err(NotFoundError)` when the source cannot be resolved in this
 *   organization, `err(BadRequestError)` for an unknown preset.
 */
export async function ensureThumbnail(
  ctx: FilesCtx,
  deps: ThumbnailEnqueueDeps,
  input: EnsureThumbnailInput
): Promise<Result<ThumbnailResult, AuxxError>> {
  return guard(async () => ensureOne(ctx, deps, input), 'Failed to ensure thumbnail', {
    source: input.source,
    preset: input.opts?.preset,
    organizationId: ctx.organizationId,
  })
}

/**
 * Ensure a set of presets for one source, in parallel.
 *
 * Replaces `core/thumbnail-batch.ts`'s `ensureThumbnailPresets`, which built a
 * `ThumbnailService` on the global `db` and looped. The source is resolved
 * **once** here rather than once per preset, which is the other half of the
 * collapse: the four-preset avatar fan-out used to run the asset lookup (and,
 * for an attachment source, the file-conversion dedup lookup) four times.
 *
 * @param ctx Scope and database.
 * @param deps Queue and clock.
 * @param input Source, actor, presets and their options.
 */
export async function ensureThumbnailPresets(
  ctx: FilesCtx,
  deps: ThumbnailEnqueueDeps,
  input: EnsureThumbnailPresetsInput
): Promise<Result<ThumbnailPresetResult[], AuxxError>> {
  return guard(
    async () => {
      const resolved = await resolveSource(ctx, deps, input.source, input.createdById)

      return Promise.all(
        input.presets.map(async (preset): Promise<ThumbnailPresetResult> => {
          const opts: ThumbnailOptions = {
            visibility: 'PUBLIC',
            ...input.defaultOptions,
            ...input.perPreset?.[preset],
            preset,
          }

          const result = await enqueueForResolvedSource(ctx, deps, {
            resolved,
            preset,
            opts,
            createdById: input.createdById,
          })

          return result.status === 'queued'
            ? { preset, status: 'queued', jobId: result.jobId }
            : {
                preset,
                status: 'ready',
                assetId: result.assetId,
                assetVersionId: result.assetVersionId,
                storageLocationId: result.storageLocationId,
              }
        })
      )
    },
    'Failed to ensure thumbnail presets',
    { source: input.source, presets: input.presets, organizationId: ctx.organizationId }
  )
}

/**
 * Resolve a source to the `MediaAssetVersion` a thumbnail derives from.
 *
 * Exported because the worker and any future producer must agree with the
 * enqueuer about which version a source means.
 *
 * **This can write.** An attachment that points at a `FolderFile` has no
 * `MediaAssetVersion` to derive from, so one is minted (`kind =
 * 'FILE_CONVERSION'`) over the same `StorageLocation`. That is why it takes
 * `deps` and why it lives in the mutations file rather than in
 * `thumbnail-queries.ts`, where `plans/attachments/05-core-services.md` §5.7 put
 * it.
 *
 * @param ctx Scope and database.
 * @param deps Clock, for the minted asset's `updatedAt`.
 * @param source Asset or attachment.
 * @param createdById Actor for a minted `FILE_CONVERSION` asset.
 */
export async function resolveThumbnailSource(
  ctx: FilesCtx,
  deps: Pick<FilesDeps, 'now'>,
  source: ThumbnailSource,
  createdById: string
): Promise<Result<ResolvedThumbnailSource, AuxxError>> {
  return guard(
    async () => resolveSource(ctx, deps, source, createdById),
    'Failed to resolve thumbnail source',
    { source, organizationId: ctx.organizationId }
  )
}

/**
 * Drop every thumbnail derived from one source version.
 *
 * Soft-deletes the derived `MediaAssetVersion` and, once nothing live is left on
 * it, the derived `MediaAsset` — after removing the storage object. Thumbnails
 * are separate `MediaAsset` rows, so deleting a source expands into N deletes
 * here; that is the closure the asset delete path depends on.
 *
 * The object is removed **before** the rows, reversing the legacy order. The old
 * `deleteThumbnailsForSource` soft-deleted first and swept storage afterwards
 * (and `processDeletions` batched every object delete to the very end), so a
 * storage failure left a row marked deleted and an object nothing pointed at any
 * more — a permanent leak with a `warn` for a headstone. Doing it the other way
 * round means a storage failure simply leaves the row for the next sweep.
 *
 * Resolves, rather than throwing, for a source version with no thumbnails —
 * that is the contract `assets/ports.ts` states.
 *
 * @param ctx Scope and database.
 * @param deps Storage and clock — see {@link ThumbnailDeleteDeps}.
 * @param sourceVersionId The `MediaAssetVersion` whose derivatives to drop.
 */
export async function deleteThumbnailsForSource(
  ctx: FilesCtx,
  deps: ThumbnailDeleteDeps,
  sourceVersionId: string
): Promise<Result<void, AuxxError>> {
  return guard(
    async () => {
      const thumbnails = await loadThumbnailsForSource(ctx, sourceVersionId)
      if (thumbnails.length === 0) return

      await processThumbnailDeletions(ctx.db, deps, thumbnails, { permanent: false })
    },
    'Failed to delete thumbnails for source',
    { sourceVersionId, organizationId: ctx.organizationId }
  )
}

/**
 * The {@link ThumbnailCleanupPort} `assets/` declared and PR 5f owes it.
 *
 * `assets/ports.ts` exists because both `MediaAsset` delete paths used to do
 * `await import('./thumbnail-service'); new ThumbnailService(org, user, db)`
 * inside the delete body, welding the write to a collaborator no test could
 * reach. This is the production implementation of the interface it declared
 * instead; the composition site (`media-asset-service.ts`) calls this once and
 * hands the result down as a parameter.
 *
 * Deliberately **swallows nothing and returns `void`**, matching the port: the
 * `Result` is unwrapped here by throwing, so a failed sweep aborts the asset
 * delete transaction it is running inside rather than committing an asset whose
 * thumbnails still point at live objects.
 *
 * @param ctx Scope and database. Pass `{ ...ctx, db: tx }` inside a transaction.
 * @param deps Storage and clock.
 */
export function createThumbnailCleanupPort(
  ctx: FilesCtx,
  deps: ThumbnailDeleteDeps
): ThumbnailCleanupPort {
  return {
    deleteThumbnailsForSource: async (sourceVersionId: string) => {
      const result = await deleteThumbnailsForSource(ctx, deps, sourceVersionId)
      if (result.isErr()) throw result.error
    },
  }
}

// ============= Internal helpers (throw; the guard converts at the boundary) =============

/** One `ensureThumbnail`, source resolution included. */
async function ensureOne(
  ctx: FilesCtx,
  deps: ThumbnailEnqueueDeps,
  input: EnsureThumbnailInput
): Promise<ThumbnailResult> {
  const preset = assertPresetKey(input.opts?.preset ?? DEFAULT_PRESET)
  const resolved = await resolveSource(ctx, deps, input.source, input.createdById)

  return enqueueForResolvedSource(ctx, deps, {
    resolved,
    preset,
    opts: input.opts ?? {},
    createdById: input.createdById,
  })
}

/**
 * The check-then-enqueue half, once the source version is known.
 *
 * Split out so {@link ensureThumbnailPresets} resolves the source once for the
 * whole fan-out instead of once per preset.
 */
async function enqueueForResolvedSource(
  ctx: FilesCtx,
  deps: ThumbnailEnqueueDeps,
  params: {
    resolved: ResolvedThumbnailSource
    preset: PresetKey
    opts: ThumbnailOptions
    createdById: string
  }
): Promise<ThumbnailResult> {
  const { resolved, preset, opts, createdById } = params
  const preValidated = assertPresetKey(preset)

  const existing = await loadThumbnail(ctx, resolved.versionId, preValidated)
  // A live row with no location is a PROCESSING placeholder, not a thumbnail.
  // Falling through re-enqueues it, which is the recovery. See the docstring.
  if (existing?.storageLocationId) {
    return {
      status: 'ready',
      assetId: existing.assetId,
      assetVersionId: existing.id,
      storageLocationId: existing.storageLocationId,
    }
  }

  const key = thumbnailJobKey(resolved.versionId, preValidated, opts)
  const jobId = await deps.queue.enqueueThumbnail({
    orgId: ctx.organizationId,
    userId: createdById,
    versionId: resolved.versionId,
    preset: preValidated,
    opts,
    key,
    visibility: opts.visibility ?? resolved.visibility,
  })

  return { status: 'queued', jobId }
}

/** {@link resolveThumbnailSource} without the `Result` wrapper. */
async function resolveSource(
  ctx: FilesCtx,
  deps: Pick<FilesDeps, 'now'>,
  source: ThumbnailSource,
  createdById: string
): Promise<ResolvedThumbnailSource> {
  if (source.type === 'asset') {
    return loadAssetSource(ctx, source.assetId, source.assetVersionId)
  }

  const attachment = await loadAttachmentSource(ctx, source.attachmentId)
  return resolveAttachmentVersion(ctx, deps, attachment, source.attachmentId, createdById)
}

/**
 * The four-step attachment resolution, in priority order.
 *
 * 1. pinned asset version — take it as-is;
 * 2. pinned file version — convert to an asset;
 * 3. unpinned asset — take its current version;
 * 4. unpinned file — convert its current version.
 *
 * Steps 2 and 4 always answer `PRIVATE`: a file-library file has no public form.
 */
async function resolveAttachmentVersion(
  ctx: FilesCtx,
  deps: Pick<FilesDeps, 'now'>,
  attachment: AttachmentThumbnailSource,
  attachmentId: string,
  createdById: string
): Promise<ResolvedThumbnailSource> {
  if (attachment.assetVersionId) {
    return {
      versionId: attachment.assetVersionId,
      visibility: attachment.asset?.isPrivate === false ? 'PUBLIC' : 'PRIVATE',
    }
  }

  if (attachment.fileVersionId) {
    if (!attachment.fileVersion) {
      throw new NotFoundError(`Attachment file version ${attachment.fileVersionId} not found`)
    }
    const converted = await convertFileVersionToAsset(
      ctx,
      deps,
      attachment.fileVersion,
      createdById
    )
    return { versionId: converted.currentVersionId, visibility: 'PRIVATE' }
  }

  if (attachment.assetId && attachment.asset?.currentVersionId) {
    return {
      versionId: attachment.asset.currentVersionId,
      visibility: attachment.asset.isPrivate ? 'PRIVATE' : 'PUBLIC',
    }
  }

  if (attachment.fileId && attachment.file?.currentVersion) {
    const converted = await convertFileVersionToAsset(
      ctx,
      deps,
      attachment.file.currentVersion,
      createdById
    )
    return { versionId: converted.currentVersionId, visibility: 'PRIVATE' }
  }

  throw new NotFoundError(`Attachment ${attachmentId} has no resolvable version`)
}

/**
 * Mint a `MediaAsset` over a `FileVersion`'s bytes so a thumbnail has something
 * to derive from.
 *
 * `derivedFromVersionId` FKs to `MediaAssetVersion`, so a `FolderFile` cannot be
 * a thumbnail source directly. The conversion is deduplicated on the shared
 * `StorageLocation`, which is the only identity available — `MediaAsset` has no
 * column to record what it was converted from.
 *
 * **Not transactional, matching the legacy behaviour.** Three statements —
 * insert asset, insert version, point the asset at the version — and a crash
 * between them leaves an asset with no current version, which the dedup lookup
 * then skips, so the next call mints a second one. Making it atomic means a
 * `tx`-first signature, and `ensureThumbnail`'s four call sites do not all have
 * a transaction to give; that is Phase 6's change, not this PR's.
 */
async function convertFileVersionToAsset(
  ctx: FilesCtx,
  deps: Pick<FilesDeps, 'now'>,
  fileVersion: FileVersionForConversion,
  createdById: string
): Promise<{ id: string; currentVersionId: string }> {
  const { storageLocationId } = fileVersion
  if (!storageLocationId) {
    throw new NotFoundError('File version has no storage location to convert')
  }

  const existing = await findConvertedAssetForLocation(ctx, storageLocationId)
  if (existing) return existing

  const now = deps.now()

  const [asset] = await ctx.db
    .insert(schema.MediaAsset)
    .values({
      organizationId: ctx.organizationId,
      createdById,
      kind: 'FILE_CONVERSION',
      purpose: 'ORIGINAL',
      mimeType: fileVersion.mimeType,
      size: fileVersion.size,
      // File-library files are always private.
      isPrivate: true,
      updatedAt: now,
    })
    .returning({ id: schema.MediaAsset.id })

  if (!asset) throw new AuxxErrorClass('File-conversion asset insert returned no row')

  const [version] = await ctx.db
    .insert(schema.MediaAssetVersion)
    .values({
      assetId: asset.id,
      versionNumber: 1,
      size: fileVersion.size,
      mimeType: fileVersion.mimeType,
      storageLocationId,
      status: 'READY',
    })
    .returning({ id: schema.MediaAssetVersion.id })

  if (!version) throw new AuxxErrorClass('File-conversion asset version insert returned no row')

  await ctx.db
    .update(schema.MediaAsset)
    .set({ currentVersionId: version.id, updatedAt: now })
    .where(eq(schema.MediaAsset.id, asset.id))

  return { id: asset.id, currentVersionId: version.id }
}
