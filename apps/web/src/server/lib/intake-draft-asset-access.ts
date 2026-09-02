// apps/web/src/server/lib/intake-draft-asset-access.ts

import { getCachedEntityDefId } from '@auxx/lib/cache'
import { NotFoundError } from '@auxx/lib/errors'
import type { CapabilitySet } from '@auxx/lib/permissions/capabilities/capability-set'
import { getIntakeDraft } from '@auxx/lib/purchasing'

/**
 * Authorize a preview of the `MediaAsset` a purchase-order intake draft was
 * started from (plans/money/tasks/38 §6.2).
 *
 * The quote is PURCHASE ORDER content: it is the document the draft is a reading
 * of, and the review screen that shows it is already gated on viewing purchase
 * orders. Gating the preview pane on `filesView` instead would deny the pane to a
 * purchasing member who does not hold the Files app while leaving the whole draft
 * they uploaded it into perfectly visible beside it — the gate would enforce no
 * boundary and only break the layout, exactly as it did for dataset documents
 * (see `assertDatasetDocumentAssetAccess`).
 *
 * The `assetRef` equality check is load-bearing for the same reason it is there:
 * without it, a caller who can view purchase orders could name any draft in the
 * org while requesting an unrelated asset and inherit the draft's authorization
 * for it.
 *
 * A missing, expired or foreign-org draft 404s before any capability is read.
 * `getIntakeDraft` builds its Redis key from the `organizationId` passed here, so
 * a draft id from another organization cannot resolve - the key prefix IS the org
 * scope, and there is no row predicate behind it to catch a mistake (§6.1).
 */
export async function assertIntakeDraftAssetAccess(
  capabilities: CapabilitySet,
  params: { draftId: string; assetId: string; organizationId: string }
): Promise<void> {
  const { draftId, assetId, organizationId } = params

  const found = await getIntakeDraft(organizationId, draftId)
  if (found.isErr()) throw found.error
  const draft = found.value

  const defId = await getCachedEntityDefId(organizationId, 'purchase_order')
  if (!defId) throw new NotFoundError('This organization has no purchase_order records yet.')
  capabilities.assertViewEntity(defId)

  // Compared as the whole ref rather than through `parseFileRef`: that helper
  // takes the branded `FileRef` and falls back to `{ sourceType: 'file' }` on a
  // malformed string, and a comparison that can pass through a fallback is not a
  // comparison. Only the intake door writes this field, and it writes
  // `asset:<mediaAssetId>`.
  if (draft.assetRef !== `asset:${assetId}`) {
    throw new NotFoundError('Quote draft asset not found')
  }
}
