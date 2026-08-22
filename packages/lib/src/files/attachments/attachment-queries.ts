// packages/lib/src/files/attachments/attachment-queries.ts

/**
 * `Attachment` reads.
 *
 * Split from `attachments/attachment-mutations.ts` per
 * `docs/lib-module-guide.md` §5 — "a file that both queries and mutates is the
 * first step back toward a service class", which is how
 * `core/attachment-service.ts` reached 1,386 lines.
 *
 * ## What `Attachment` is
 *
 * A polymorphic join row: `(entityType, entityId)` names the host — a message, a
 * comment, a field value, a QC checklist item — and exactly one of `fileId`
 * (file library) or `assetId` (media library) names the target. The optional
 * `fileVersionId` / `assetVersionId` **pins** the attachment to one version
 * instead of tracking whichever version is current.
 *
 * ## Two things the schema settles, so no read below has to guess
 *
 * - `Attachment.organizationId` is `NOT NULL`, so `eq(...)` scoping hides no
 *   rows. Unlike `StorageLocation` (nullable for backfill compatibility), there
 *   is no pre-backfill population to keep visible, and every read here is
 *   org-scoped unconditionally. The legacy bodies called `requireOrganization()`
 *   which *threw* when a service had no org — several production sites construct
 *   one without an actor but always with an org, so this is parity, not a
 *   loosening.
 * - **There is no `deletedAt` column.** Attachments are hard-deleted, so no read
 *   here filters one, and `deleteAttachment` really removes the row.
 */

import { schema } from '@auxx/database'
import type { AttachmentEntity } from '@auxx/database/types'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import { BadRequestError, NotFoundError } from '../../errors'
import type { EntityType } from '../core/types'
import type { FilesCtx } from '../ctx'
import { guard } from '../guard'

/**
 * The display shape {@link fetchAttachmentsForEntities} groups rows into.
 *
 * Flattens the file/asset split away: `type` says which side the row came from
 * and `fileId` carries that side's id, so a renderer never has to branch on two
 * nullable columns. Re-exported by the deprecated `AttachmentService` facade
 * because `messages/attachment-transformers.ts` imports it from there.
 */
export interface GroupedAttachmentInfo {
  id: string
  role: string
  title?: string | null
  sort: number
  createdAt: Date
  type: 'file' | 'asset'
  /** The `MediaAsset.id` when `type` is `'asset'`, the `FolderFile.id` when it is `'file'`. */
  fileId: string
  name: string
  mimeType?: string | null
  size?: number | null
}

/** Which library an attachment points at. */
export type AttachmentSide = 'file' | 'asset'

/**
 * The bytes an attachment currently resolves to.
 *
 * **This type is the point of the extraction.** The legacy `resolveVersion`
 * returned `{ attachment, version: any, storageLocationId, side, isPinned }`,
 * and the `any` hid a live defect: two of its four branches project a version
 * row *without* an `id` column and none of them project a `name`, yet
 * `getDownloadInfo` read `version.name` for the download filename. It was always
 * `undefined`, so every unpinned download fell through to the literal
 * `'attachment'`. A named shape refuses to compile that read, which is how the
 * bug surfaced. `versionId` is `null` on the unpinned branches for the same
 * reason — the projection genuinely does not fetch it.
 */
export interface ResolvedAttachmentVersion {
  attachment: AttachmentEntity
  side: AttachmentSide
  /** True when the attachment pins a version rather than tracking the current one. */
  isPinned: boolean
  /** The pinned version's id. `null` when the attachment tracks the current version. */
  versionId: string | null
  storageLocationId: string
  mimeType: string | null
  size: number | null
}

/**
 * Load one attachment, scoped to the caller's organization.
 *
 * Returns `ok(null)` when the row does not exist or belongs to another
 * organization — the two collapse into one answer so a caller cannot probe for
 * ids outside its tenant.
 *
 * @param ctx Scope and database. Runs unchanged on a pool or inside a caller's
 *   transaction, because `FilesCtx.db` is `Database | Transaction`.
 * @param attachmentId The `Attachment.id` to load.
 */
export async function getAttachment(
  ctx: FilesCtx,
  attachmentId: string
): Promise<Result<AttachmentEntity | null, AuxxError>> {
  return guard(
    async () => {
      const [row] = await ctx.db
        .select()
        .from(schema.Attachment)
        .where(
          and(
            eq(schema.Attachment.id, attachmentId),
            eq(schema.Attachment.organizationId, ctx.organizationId)
          )
        )
        .limit(1)
      return (row as AttachmentEntity | undefined) ?? null
    },
    'Failed to get attachment',
    { attachmentId, organizationId: ctx.organizationId }
  )
}

/**
 * Every attachment on one host entity, in display order.
 *
 * Ordered `sort` then `createdAt`, the order the legacy `getEntityAttachments`
 * used and the one the UI renders in. `sort` is `NOT NULL DEFAULT 0`, so rows
 * written without an explicit position tie and fall back to creation order.
 */
export async function getEntityAttachments(
  ctx: FilesCtx,
  entityType: EntityType,
  entityId: string
): Promise<Result<AttachmentEntity[], AuxxError>> {
  return guard(
    async () => {
      const rows = await ctx.db
        .select()
        .from(schema.Attachment)
        .where(
          and(
            eq(schema.Attachment.organizationId, ctx.organizationId),
            eq(schema.Attachment.entityType, entityType),
            eq(schema.Attachment.entityId, entityId)
          )
        )
        .orderBy(asc(schema.Attachment.sort), asc(schema.Attachment.createdAt))
      return rows as AttachmentEntity[]
    },
    'Failed to list entity attachments',
    { entityType, entityId, organizationId: ctx.organizationId }
  )
}

/**
 * The batch loader on the mail read path: attachments for many hosts at once.
 *
 * **One statement, whatever `entityIds.length` is.** A single `SELECT` over
 * `Attachment` with the two libraries `LEFT JOIN`ed in, filtered by
 * `entityId IN (…)`, grouped in memory afterwards. `messages/` calls this once
 * per page of messages and `comments/` once per page of comments, so turning it
 * into a per-entity loop would multiply every mail list render by its page size.
 * The join shape, the projection, the `WHERE` and the `ORDER BY` are carried
 * over verbatim from `AttachmentService.fetchAttachmentsForEntities`.
 *
 * An empty `entityIds` short-circuits to an empty map without touching the
 * database — `inArray(col, [])` is not a query worth issuing.
 *
 * Entities with no attachments are simply absent from the map rather than
 * present with an empty array; callers already treat a miss as "none".
 *
 * @param ctx Scope and database.
 * @param entityType The host kind every id in `entityIds` belongs to.
 * @param entityIds The hosts to load for.
 */
export async function fetchAttachmentsForEntities(
  ctx: FilesCtx,
  entityType: EntityType,
  entityIds: string[]
): Promise<Result<Map<string, GroupedAttachmentInfo[]>, AuxxError>> {
  return guard(
    async () => {
      if (entityIds.length === 0) return new Map<string, GroupedAttachmentInfo[]>()

      const rows = await ctx.db
        .select({
          id: schema.Attachment.id,
          entityId: schema.Attachment.entityId,
          role: schema.Attachment.role,
          title: schema.Attachment.title,
          sort: schema.Attachment.sort,
          createdAt: schema.Attachment.createdAt,
          assetId: schema.Attachment.assetId,
          fileId: schema.Attachment.fileId,
          // Asset info
          assetName: schema.MediaAsset.name,
          assetMimeType: schema.MediaAsset.mimeType,
          assetSize: schema.MediaAsset.size,
          // File info
          fileName: schema.FolderFile.name,
          fileMimeType: schema.FolderFile.mimeType,
          fileSize: schema.FolderFile.size,
        })
        .from(schema.Attachment)
        .leftJoin(schema.MediaAsset, eq(schema.Attachment.assetId, schema.MediaAsset.id))
        .leftJoin(schema.FolderFile, eq(schema.Attachment.fileId, schema.FolderFile.id))
        .where(
          and(
            eq(schema.Attachment.entityType, entityType),
            inArray(schema.Attachment.entityId, entityIds),
            eq(schema.Attachment.organizationId, ctx.organizationId)
          )
        )
        .orderBy(asc(schema.Attachment.sort), asc(schema.Attachment.createdAt))

      const grouped = new Map<string, GroupedAttachmentInfo[]>()
      for (const row of rows) {
        const bucket = grouped.get(row.entityId) ?? []
        bucket.push({
          id: row.id,
          role: row.role,
          title: row.title,
          sort: row.sort,
          createdAt: row.createdAt,
          type: row.assetId ? 'asset' : 'file',
          // Non-null by the XOR invariant `createAttachment` enforces at write
          // time; a row with neither could only come from a direct database
          // write. Kept as the legacy `!` had it rather than dropped, because
          // silently filtering rows would be a behaviour change under cover of
          // a refactor.
          fileId: (row.assetId ?? row.fileId) as string,
          name: row.assetName || row.fileName || 'Untitled',
          mimeType: row.assetMimeType || row.fileMimeType,
          size: row.assetSize || row.fileSize,
        })
        grouped.set(row.entityId, bucket)
      }
      return grouped
    },
    'Failed to fetch attachments for entities',
    { entityType, entityCount: entityIds.length, organizationId: ctx.organizationId }
  )
}

/**
 * Resolve which stored bytes an attachment currently points at.
 *
 * Four branches, one per (side, pinned?) combination:
 *
 * | side  | pinned | resolves through                                   |
 * | ----- | ------ | -------------------------------------------------- |
 * | file  | yes    | `FileVersion` by `fileVersionId`                    |
 * | file  | no     | `FolderFile.currentVersionId` → `FileVersion`       |
 * | asset | yes    | `MediaAssetVersion` by `assetVersionId`             |
 * | asset | no     | `MediaAsset.currentVersionId` → `MediaAssetVersion` |
 *
 * The version and library lookups are keyed by ids read off the attachment row,
 * which was already org-scoped by {@link requireAttachment}, so they need no
 * organization filter of their own — a foreign tenant's version id is not
 * reachable without first holding that tenant's attachment.
 *
 * Throws `NotFoundError` for a missing attachment, `BadRequestError` for a row
 * that references neither library or whose target has no storage location.
 */
export async function resolveAttachmentVersion(
  ctx: FilesCtx,
  attachmentId: string
): Promise<Result<ResolvedAttachmentVersion, AuxxError>> {
  return guard(
    async () => requireResolvedVersion(ctx, attachmentId),
    'Failed to resolve attachment version',
    { attachmentId, organizationId: ctx.organizationId }
  )
}

// ============= Internal helpers (throw; the guard converts at the boundary) =============

/**
 * Load an attachment or throw `NotFoundError`.
 *
 * Exported for `attachment-mutations.ts`, which needs the same org-scoped
 * existence check before it writes and must throw rather than return `err()` so
 * a failure inside a caller's transaction rolls it back.
 */
export async function requireAttachment(
  ctx: FilesCtx,
  attachmentId: string
): Promise<AttachmentEntity> {
  const [row] = await ctx.db
    .select()
    .from(schema.Attachment)
    .where(
      and(
        eq(schema.Attachment.id, attachmentId),
        eq(schema.Attachment.organizationId, ctx.organizationId)
      )
    )
    .limit(1)
  if (!row) throw new NotFoundError(`Attachment ${attachmentId} not found`)
  return row as AttachmentEntity
}

/** {@link resolveAttachmentVersion}'s body, throwing rather than wrapped. */
export async function requireResolvedVersion(
  ctx: FilesCtx,
  attachmentId: string
): Promise<ResolvedAttachmentVersion> {
  const attachment = await requireAttachment(ctx, attachmentId)

  if (attachment.fileId) {
    const target = attachment.fileVersionId
      ? await loadFileVersionById(ctx, attachment.fileVersionId)
      : await loadCurrentFileVersion(ctx, attachment.fileId)
    return finish(attachment, 'file', !!attachment.fileVersionId, target)
  }

  if (attachment.assetId) {
    const target = attachment.assetVersionId
      ? await loadAssetVersionById(ctx, attachment.assetVersionId)
      : await loadCurrentAssetVersion(ctx, attachment.assetId)
    return finish(attachment, 'asset', !!attachment.assetVersionId, target)
  }

  throw new BadRequestError('Attachment has no valid file or asset reference')
}

/** What every branch of {@link requireResolvedVersion} narrows down to. */
interface VersionTarget {
  versionId: string | null
  storageLocationId: string | null
  mimeType: string | null
  size: number | null
}

function finish(
  attachment: AttachmentEntity,
  side: AttachmentSide,
  isPinned: boolean,
  target: VersionTarget | null
): ResolvedAttachmentVersion {
  if (!target?.storageLocationId) {
    throw new BadRequestError('No storage location available for attachment')
  }
  return {
    attachment,
    side,
    isPinned,
    versionId: target.versionId,
    storageLocationId: target.storageLocationId,
    mimeType: target.mimeType,
    size: target.size,
  }
}

async function loadFileVersionById(
  ctx: FilesCtx,
  fileVersionId: string
): Promise<VersionTarget | null> {
  const [row] = await ctx.db
    .select({
      id: schema.FileVersion.id,
      mimeType: schema.FileVersion.mimeType,
      size: schema.FileVersion.size,
      storageLocationId: schema.FileVersion.storageLocationId,
    })
    .from(schema.FileVersion)
    .where(eq(schema.FileVersion.id, fileVersionId))
    .limit(1)
  return row ? { ...row, versionId: row.id } : null
}

async function loadCurrentFileVersion(
  ctx: FilesCtx,
  fileId: string
): Promise<VersionTarget | null> {
  const [row] = await ctx.db
    .select({
      mimeType: schema.FileVersion.mimeType,
      size: schema.FileVersion.size,
      storageLocationId: schema.FileVersion.storageLocationId,
    })
    .from(schema.FolderFile)
    .innerJoin(schema.FileVersion, eq(schema.FolderFile.currentVersionId, schema.FileVersion.id))
    .where(eq(schema.FolderFile.id, fileId))
    .limit(1)
  return row ? { ...row, versionId: null } : null
}

async function loadAssetVersionById(
  ctx: FilesCtx,
  assetVersionId: string
): Promise<VersionTarget | null> {
  const [row] = await ctx.db
    .select({
      id: schema.MediaAssetVersion.id,
      mimeType: schema.MediaAssetVersion.mimeType,
      size: schema.MediaAssetVersion.size,
      storageLocationId: schema.MediaAssetVersion.storageLocationId,
    })
    .from(schema.MediaAssetVersion)
    .where(eq(schema.MediaAssetVersion.id, assetVersionId))
    .limit(1)
  return row ? { ...row, versionId: row.id } : null
}

async function loadCurrentAssetVersion(
  ctx: FilesCtx,
  assetId: string
): Promise<VersionTarget | null> {
  const [row] = await ctx.db
    .select({
      mimeType: schema.MediaAssetVersion.mimeType,
      size: schema.MediaAssetVersion.size,
      storageLocationId: schema.MediaAssetVersion.storageLocationId,
    })
    .from(schema.MediaAsset)
    .innerJoin(
      schema.MediaAssetVersion,
      eq(schema.MediaAsset.currentVersionId, schema.MediaAssetVersion.id)
    )
    .where(eq(schema.MediaAsset.id, assetId))
    .limit(1)
  return row ? { ...row, versionId: null } : null
}
