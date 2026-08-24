// packages/lib/src/files/upload/handlers/visit-qc-item.ts

import { schema } from '@auxx/database'
import { UPLOAD_POLICIES } from '../../types/entities'
import { assertRowInOrg } from './shared'
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
  ...UPLOAD_POLICIES.visit_qc_item,
  visibility: 'PRIVATE',
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
