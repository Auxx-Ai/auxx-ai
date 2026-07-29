// packages/types/signature/index.ts

import type { RecordId } from '../resource'

/**
 * One signature as the client consumes it — the client mirror of the signature
 * router's `SignatureView` (`apps/web/src/server/api/routers/signature.ts`).
 *
 * Plan 36 removed the two fields that used to live here: `visibility` (a
 * decorative `SINGLE_SELECT` nothing ever filtered on) and `isDefault` (an
 * org-global FieldValue). Sharing is now `ResourceAccess` rows written through
 * `resourceAccess.grantInstance`, and "default" is a per-user `UserSetting`
 * (`signature.defaultId`) read via `signature.getDefault`. Neither is a property
 * of the signature any more, so neither belongs on this type.
 */
export interface SignatureItem {
  /** The `EntityInstance.id`. Every `signature.*` procedure is keyed on this. */
  id: string
  /**
   * The SHARING record id — `signature:<id>`, the slug form the `ResourceAccess`
   * rows are keyed on and the form `resourceAccess.*` / the instance-share
   * components expect. NOT the generic `<defUuid>:<instanceId>` record id:
   * nothing routes signatures through `record.*` any more.
   */
  recordId: RecordId
  name: string
  body: string
  createdById: string | null
}
