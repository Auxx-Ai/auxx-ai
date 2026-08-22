// packages/lib/src/files/upload/processors/visit-qc-processor.ts

import { database as db, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { NotFoundError } from '../../../errors'
import type { AssetKind } from '../../core/types'
import { BaseAttachmentProcessor } from './base-attachment-processor'

/**
 * Upload processor for `VisitQcItem` checklist photos (08-worker-surface.md §5, 37d §2).
 *
 * These are worker-captured job-site photos, so the upload must produce a `MediaAsset` **and**
 * an `Attachment` (`entityType: 'visit_qc_item'`) — that `MediaAsset` id is what
 * `qc-photo-strip.tsx` hands back to `add{My,Visit}VisitQcItemPhoto`. Before this processor
 * existed the entity type had no registration at all and fell through to the registry's default
 * `FileProcessor`, which produced a `FolderFile` and no `assetId`
 * (`docs/files-upload-architecture-guide.md` §11.3).
 */
export class VisitQcItemProcessor extends BaseAttachmentProcessor {
  protected readonly entityType = 'visit_qc_item'
  protected readonly fileVisibility = 'PRIVATE'
  protected readonly preferredProvider = 'S3'
  protected readonly maxFileSize = 25 * 1024 * 1024 // 25MB
  /**
   * Images only, and no `image/*` wildcard — that would admit `image/svg+xml`, an XSS vector
   * when uploaded files are served from our origin.
   *
   * HEIC/HEIF are included because the strip's input is `accept='image/*' capture='environment'`
   * and does **not** run `convertHeicToJpeg` (`components/files/utils/convert-heic.ts`), which is
   * in any case best-effort — it only decodes in Safari and otherwise hands back the original
   * HEIC file. Rejecting HEIC here would drop iPhone camera captures on the floor.
   */
  protected readonly allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
  ]
  protected readonly assetKind: AssetKind = 'INLINE_IMAGE'

  /**
   * Org-scoped existence check, mirroring `loadQcItemInOrg` in `lib/src/dispatch/qc.ts`.
   *
   * Assignee ownership is deliberately NOT checked here: the strip is shared by the worker
   * surface and the office proof-of-work panel, and the two differ only in which attach
   * mutation runs afterwards (`addMyVisitQcItemPhoto` re-guards on the visit's assignee,
   * `addVisitQcItemPhoto` is org-scoped). Org scope is the guarantee this upload door owes.
   */
  protected async validateEntityAccess(entityId: string, organizationId: string): Promise<void> {
    const [item] = await db
      .select({ id: schema.VisitQcItem.id })
      .from(schema.VisitQcItem)
      .where(
        and(
          eq(schema.VisitQcItem.id, entityId),
          eq(schema.VisitQcItem.organizationId, organizationId)
        )
      )
      .limit(1)

    if (!item) {
      throw new NotFoundError('Quality check item not found')
    }
  }
}
