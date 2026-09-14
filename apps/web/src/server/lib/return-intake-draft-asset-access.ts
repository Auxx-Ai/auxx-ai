// apps/web/src/server/lib/return-intake-draft-asset-access.ts

import { getCachedEntityDefId } from '@auxx/lib/cache'
import { NotFoundError } from '@auxx/lib/errors'
import type { CapabilitySet } from '@auxx/lib/permissions/capabilities/capability-set'
// 🛑 The LEAF subpath, never the `@auxx/lib/returns/intake` barrel. The barrel
// reaches transcribe.ts, commit.ts and the LLM orchestrator, and `file.ts`
// imports this module — so the barrel pulled that whole graph into every test
// that partially mocks `drizzle-orm` or `@auxx/lib/errors`, breaking two
// unrelated router suites at collection time. `draft-queries.ts` needs only
// Redis and one constant.
import { getReturnIntakeDraft } from '@auxx/lib/returns/intake/draft-queries'

/**
 * Authorize a preview of a label photo a return-intake draft was read from
 * (plans/money/tasks/57 §7.2, the sibling of `assertIntakeDraftAssetAccess`).
 *
 * The photograph is RETURN content: it is the evidence the draft is a reading
 * of, and the review route that shows it is already gated on viewing `return`.
 * Gating the pane on `filesView` instead — which is what the default `files`
 * preview scope does — denies the photo to a dock account that has returns
 * access but not the Files app, on the one screen whose entire job is checking a
 * transcription against the photo. The gate would enforce no boundary there and
 * only break the layout, exactly as it did for vendor quotes and for dataset
 * documents.
 *
 * The asset-reference check is load-bearing for the same reason it is there for
 * quotes: without it, a caller who can view returns could name any draft in the
 * org while requesting an unrelated asset and inherit the draft's authorization
 * for it. A return draft carries MANY photos rather than one, so this is a
 * membership test over the draft's labels instead of an equality test — an asset
 * that is not one of this draft's labels is refused.
 *
 * A missing, expired or foreign-org draft 404s before any capability is read.
 * `getReturnIntakeDraft` builds its Redis key from the `organizationId` passed
 * here, which comes from the session and never from the client — the key prefix
 * IS the org scope, and there is no row predicate behind it to catch a mistake
 * (§6.1).
 */
export async function assertReturnIntakeDraftAssetAccess(
  capabilities: CapabilitySet,
  params: { draftId: string; assetId: string; organizationId: string }
): Promise<void> {
  const { draftId, assetId, organizationId } = params

  const found = await getReturnIntakeDraft(organizationId, draftId)
  if (found.isErr()) throw found.error
  const draft = found.value

  const defId = await getCachedEntityDefId(organizationId, 'return')
  if (!defId) throw new NotFoundError('This organization has no return records yet.')
  capabilities.assertViewEntity(defId)

  // Compared as the whole ref rather than through `parseFileRef`: that helper
  // takes the branded `FileRef` and falls back to `{ sourceType: 'file' }` on a
  // malformed string, and a comparison that can pass through a fallback is not a
  // comparison. Only the intake upload writes this field, and it writes
  // `asset:<mediaAssetId>`.
  const ref = `asset:${assetId}`
  if (!draft.payload.labels.some((label) => label.fileRef === ref)) {
    throw new NotFoundError('Label photo not found')
  }
}
