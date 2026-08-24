// packages/lib/src/files/upload/persist.ts

/**
 * Turning a finished upload into rows.
 *
 * ## What this replaced
 *
 * `BaseProcessor.process` → `executeProcess`, overridden at four levels. Each
 * level did some of the work and delegated the rest upward, so "what rows does a
 * knowledge-base logo upload create?" meant reading `KnowledgeBaseProcessor`,
 * `BaseAttachmentProcessor`, `BaseAssetProcessor` and `BaseProcessor` in that
 * order and holding four `super` calls in your head. Three of those overrides
 * also opened their **own** `mediaAssetService.getTx(...)` while the route
 * already had a transaction open, which Drizzle answers with a `SAVEPOINT` —
 * the trap #1851 hit, where isolation silently depends on the caller.
 *
 * Here there is one function, one `switch`, and no transaction of its own: `tx`
 * is a parameter, positional and first, because {@link persistUpload} writes
 * several rows that have to land together and a pool would typecheck into a
 * `FilesCtx.db` slot while quietly dropping that guarantee (`files/ctx.ts`).
 *
 * ## The strategy decides the rows, and it is the only thing that does
 *
 * A file is `StorageLocation` (the bytes) + `MediaAsset`+version **or**
 * `FolderFile`+version, optionally plus an `Attachment`
 * (`docs/files-upload-architecture-guide.md`). Which combination you get was
 * decided by which processor class the registry happened to hand back; it is
 * decided by {@link UploadHandler.persist} now, which is a value the compiler
 * checks exhaustively.
 *
 * ## Style A: this body throws
 *
 * Every collaborator here returns a `Result` and is unwrapped, because returning
 * `err()` from inside `db.transaction` does **not** roll back — the body
 * resolves normally and the caller commits rows it was just told failed to
 * write. `completeUpload`'s `guard` converts at the exported boundary, outside
 * the transaction (`plans/attachments/06` §6.4).
 */

import type { Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import type { MediaAssetEntity, StorageLocationEntity } from '@auxx/database/types'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { AuxxError, BadRequestError } from '../../errors'
import { createAssetWithVersion } from '../assets/asset-mutations'
import { updateAssetContent } from '../assets/version-mutations'
import { createAttachment } from '../attachments/attachment-mutations'
import type { AssetKind, AttachmentRole, EntityType as CoreEntityType } from '../core/types'
import type { FilesCtx } from '../ctx'
import { createFolderFileWithVersion } from '../folder-files/file-mutations'
import { unwrap } from '../guard'
import type { PersistResult, UploadHandler, UploadPersistDeps } from './handlers/types'
import type { PresignedUploadSession } from './session-types'

/**
 * The `StorageLocation` fields the persistence step reads.
 *
 * `externalUrl` is `NOT NULL` on the table and `createStorageLocation` writes
 * `''` when there is nothing to record, so a PRIVATE upload arrives here as the
 * empty string rather than as `null`. The hooks that write it onward
 * (`KnowledgeBase.logoLight`, `User.image`) treat `''` as "leave it alone".
 */
export type PersistLocation = Pick<StorageLocationEntity, 'id' | 'externalUrl'>

/**
 * Write the rows one completed upload produces, inside the caller's transaction.
 *
 * @param tx The caller's transaction. Never `tx.transaction(…)`ed here — a
 *   nested call issues a `SAVEPOINT`, which is not a transaction boundary.
 * @param ctx Scope. `ctx.db` is ignored; every statement runs on `tx`.
 * @param deps `now`, for the `updatedAt` stamps the underlying writes need.
 * @param handler The entity type's handler. `handler.persist` selects the shape.
 * @param session The finished upload session.
 * @param location The `StorageLocation` row the bytes were just recorded at.
 * @throws {BadRequestError} when an `asset+attachment` session carries no
 *   `entityId` — `prepareUpload` refuses that at the front door, so reaching
 *   here means a session was hand-built.
 */
export async function persistUpload(
  tx: Transaction,
  ctx: FilesCtx,
  deps: UploadPersistDeps,
  handler: UploadHandler,
  session: PresignedUploadSession,
  location: PersistLocation
): Promise<PersistResult> {
  // Nested reads must see this transaction's uncommitted rows, so they get
  // `{ ...ctx, db: tx }` rather than the outer `ctx` on the pool.
  const txCtx: FilesCtx = { ...ctx, db: tx }
  const externalUrl = location.externalUrl

  let result: PersistResult

  if (handler.persist === 'folder-file') {
    const { file } = unwrap(
      await createFolderFileWithVersion(tx, txCtx, deps, {
        name: session.fileName,
        // No `path`: `createFolderFileWithVersion` derives a collision-safe one.
        ext: fileExtension(session.fileName),
        mimeType: session.mimeType,
        size: session.expectedSize,
        createdById: session.userId,
        folderId: session.metadata?.folderId,
        storageLocationId: location.id,
      })
    )
    result = { storageLocationId: location.id, fileId: file.id, externalUrl }
  } else {
    const assetId = await writeAsset(tx, txCtx, deps, handler, session, location.id)
    result = { storageLocationId: location.id, assetId, externalUrl }

    if (handler.persist === 'asset+attachment') {
      result.attachmentId = await writeAttachment(txCtx, session, assetId)
    }
  }

  // `txCtx`, not `ctx`: an `onPersist` that reads before it writes has to see
  // the rows this transaction has just written. Handing it the pool would be
  // Tier-1 §1.3 inside the transaction instead of outside it.
  const extra = await handler.onPersist?.(tx, txCtx, deps, result, session)
  return extra ? { ...result, ...extra } : result
}

// ============= Internal helpers (throw; `completeUpload`'s guard converts) =============

/**
 * Create the `MediaAsset`, or add a version to the entity's existing one.
 *
 * `isPrivate` comes from `session.visibility`, which `buildUploadConfig` already
 * resolved — including the `ARTICLE` cover override. `BaseAssetProcessor`
 * answered this with its own `fileVisibility === 'PRIVATE'` field instead, which
 * is how `DatasetAssetProcessor`'s lowercase `'private'` made every dataset
 * document non-private while also routing it to the public bucket. One source
 * for the answer means the two cannot disagree.
 */
async function writeAsset(
  tx: Transaction,
  txCtx: FilesCtx,
  deps: UploadPersistDeps,
  handler: UploadHandler,
  session: PresignedUploadSession,
  storageLocationId: string
): Promise<string> {
  const kind = resolveAssetKind(handler, session)

  if (handler.persist === 'versioned-asset') {
    const existing = await findVersionedAsset(tx, txCtx, kind, session.entityId || session.userId)
    if (existing) {
      const { asset } = unwrap(
        await updateAssetContent(tx, txCtx, deps, {
          assetId: existing.id,
          storageLocationId,
          size: session.expectedSize,
          mimeType: session.mimeType,
        })
      )
      return asset.id
    }
  }

  const { asset } = unwrap(
    await createAssetWithVersion(tx, txCtx, deps, {
      kind,
      purpose: 'ORIGINAL',
      name: session.fileName,
      mimeType: session.mimeType,
      size: session.expectedSize,
      isPrivate: session.visibility === 'PRIVATE',
      createdById: session.userId,
      // Stamped at insert rather than by the follow-up `UPDATE` the processors
      // issued; the committed row is the same one.
      expiresAt: handler.assetExpiresAt?.(session, deps.now),
      storageLocationId,
    })
  )
  return asset.id
}

/** Link the asset to the entity the session names. */
async function writeAttachment(
  txCtx: FilesCtx,
  session: PresignedUploadSession,
  assetId: string
): Promise<string> {
  if (!session.entityId) {
    throw new BadRequestError(`Entity ID is required for ${session.entityType} attachments`)
  }

  const attachment = unwrap(
    await createAttachment(txCtx, {
      // `files/types/entities.ts` and `files/core/types.ts` carry two `EntityType`
      // unions and the attachment one is missing `CUSTOM_FIELD`. The column is
      // `text`, every value here is already a validated `EntityType`, and
      // reconciling the two unions is not this PR's change.
      entityType: session.entityType as CoreEntityType,
      entityId: session.entityId,
      // `||`, not `??`, matching `BaseAttachmentProcessor`: an empty-string role
      // in the metadata means "unset", and the column default is `ATTACHMENT`.
      role: (session.metadata?.role as AttachmentRole | undefined) || 'ATTACHMENT',
      title: session.metadata?.title || session.fileName,
      caption: session.metadata?.caption,
      createdById: session.userId,
      assetId,
    })
  )
  return attachment.id
}

/**
 * The entity's most recent live asset of this kind, if it has one.
 *
 * `createdById` is the match column rather than an entity join, because
 * `USER_PROFILE` — the only `versioned-asset` handler — has no attachment row to
 * join through: the avatar's owner *is* the asset's author.
 *
 * **Known gap, inherited:** an agent avatar uploaded by an admin is created with
 * `createdById = <the admin>`, so this lookup misses it on the next upload and a
 * second asset is minted instead of a version being added. Preserved rather than
 * fixed — changing the match column would re-point live `User.avatarAssetId`
 * rows at different assets.
 */
async function findVersionedAsset(
  tx: Transaction,
  txCtx: FilesCtx,
  kind: AssetKind,
  ownerId: string
): Promise<MediaAssetEntity | null> {
  const [asset] = await tx
    .select()
    .from(schema.MediaAsset)
    .where(
      and(
        eq(schema.MediaAsset.kind, kind),
        eq(schema.MediaAsset.createdById, ownerId),
        eq(schema.MediaAsset.organizationId, txCtx.organizationId),
        isNull(schema.MediaAsset.deletedAt)
      )
    )
    .orderBy(desc(schema.MediaAsset.createdAt))
    .limit(1)

  return (asset as MediaAssetEntity | undefined) ?? null
}

/** The declared kind, or the one this session resolves to. */
function resolveAssetKind(handler: UploadHandler, session: PresignedUploadSession): AssetKind {
  if (!handler.assetKind) {
    // Only a `folder-file` handler may omit it, and that branch never gets here,
    // so this is a handler-authoring mistake rather than a bad request — a 500,
    // not a 400 blaming the client for our record.
    throw new AuxxError(`No asset kind declared for entity type: ${handler.entityType}`)
  }
  return typeof handler.assetKind === 'function' ? handler.assetKind(session) : handler.assetKind
}

/** `report.final.csv` → `csv`. `undefined` when there is no usable extension. */
function fileExtension(fileName: string): string | undefined {
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot === -1 || lastDot === fileName.length - 1) return undefined
  return fileName.substring(lastDot + 1).toLowerCase()
}
