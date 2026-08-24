// packages/lib/src/files/upload/handlers/visit-qc-item.ts

import { schema } from '@auxx/database'
import { ENTITY_TYPES } from '../../types/entities'
import { ASSET_MAX_TTL_SEC, assertRowInOrg, MB } from './shared'
import type { UploadHandler } from './types'

/**
 * Worker-captured job-site photos on a visit quality-check item
 * (08-worker-surface.md §5, 37d §2).
 *
 * The upload must produce a `MediaAsset` **and** an `Attachment`
 * (`entityType: 'visit_qc_item'`) — that `MediaAsset` id is what
 * `qc-photo-strip.tsx` hands back to `add{My,Visit}VisitQcItemPhoto`. Before
 * `VisitQcItemProcessor` existed the entity type had no registration at all and
 * fell through to the registry's default `FileProcessor`, which produced a
 * `FolderFile` and no `assetId` (`docs/files-upload-architecture-guide.md`
 * §11.3). `satisfies Record<EntityType, UploadHandler>` in `handlers/index.ts` is
 * what makes that unrepresentable now.
 */
export const visitQcItemHandler: UploadHandler = {
  entityType: ENTITY_TYPES.VISIT_QC_ITEM,
  visibility: 'PRIVATE',
  maxFileSize: 25 * MB,
  /**
   * Images only, and no `image/*` wildcard — that would admit `image/svg+xml`,
   * an XSS vector when uploaded files are served from our origin.
   *
   * HEIC/HEIF are included because the strip's input is `accept='image/*'
   * capture='environment'` and does **not** run `convertHeicToJpeg`
   * (`components/files/utils/convert-heic.ts`), which is in any case
   * best-effort — it only decodes in Safari and otherwise hands back the
   * original HEIC file. Rejecting HEIC here would drop iPhone captures.
   */
  allowedMimeTypes: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
  ],
  maxTtlSec: ASSET_MAX_TTL_SEC,
  assetKind: 'INLINE_IMAGE',
  persist: 'asset+attachment',

  /**
   * Org-scoped existence check, mirroring `loadQcItemInOrg` in
   * `lib/src/dispatch/qc.ts`.
   *
   * Assignee ownership is deliberately NOT checked: the strip is shared by the
   * worker surface and the office proof-of-work panel, and the two differ only
   * in which attach mutation runs afterwards (`addMyVisitQcItemPhoto` re-guards
   * on the visit's assignee, `addVisitQcItemPhoto` is org-scoped). Org scope is
   * the guarantee this upload door owes.
   */
  validateEntity: (ctx, init) =>
    assertRowInOrg(ctx, schema.VisitQcItem, init.entityId as string, 'Quality check item'),
}
