// packages/lib/src/returns/intake/draft-queries.ts

/**
 * Reads over the return-intake draft (plans/money/tasks/57 §6.1).
 *
 * ## Why Redis and not a table
 *
 * A draft has no query surface — there is deliberately no `listDrafts`, because
 * finding an in-flight draft is a pointer the browser keeps (the review route's
 * own `[draftId]` segment). It has no reporting, no joins, no retention
 * requirement, and its TTL IS its whole lifecycle policy.
 *
 * 🛑 The reason this is not a `return` with `status: 'requested'` is load-bearing
 * and is `purchasing/intake/draft-mutations.ts`'s reason applied to this record:
 * `return.number` is minted by the RecordSequence hook with prefix `RMA`, so a
 * photographed label that turns out to be a duplicate — the same pallet
 * photographed twice by two people on the same dock — would burn an RMA number
 * and leave a gap behind. *"A plan the user abandons at the preview must leave no
 * records behind."*
 *
 * ## 🛑 The org id is IN THE KEY, and that key prefix IS the org scope
 *
 * There is no row to filter and no `WHERE organizationId = …` to fall back on.
 * Every read builds the full key from the CALLER'S OWN `organizationId`, so a
 * draft id leaked out of one org addresses a key that does not exist in another.
 * A lookup by draft id alone would be a cross-tenant read with nothing behind it
 * to catch the mistake — never add one.
 *
 * There is exactly ONE read, and that is the design: drafts are actionable and
 * self-clearing within 24 hours, not history.
 *
 * No permission checks. The router asserts on `return` and calls in
 * (docs/lib-module-guide.md §6).
 */

import { getRedisData } from '@auxx/redis'
import type { Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import { TEMP_ASSET_TTL_MS } from '../../files/upload/handlers/shared'
import type { ReturnIntakeDraftView } from './client'
import { guard } from './guard'

/**
 * How long a draft survives, derived from the temp upload's own window.
 *
 * 🛑 Never a hardcoded `86400`. The draft and the photos it describes must
 * expire together: if the assets went first, the review screen would come back
 * with live transcriptions beside dead image panes — and checking a
 * transcription against the crumpled label is the whole job of that screen
 * (§7.3). Deriving it is what stops the two drifting apart.
 */
export const RETURN_INTAKE_DRAFT_TTL_SECONDS = Math.floor(TEMP_ASSET_TTL_MS / 1000)

/** What is actually stored: the view, plus who may be offered it back. */
export interface StoredReturnIntakeDraft extends ReturnIntakeDraftView {
  organizationId: string
  createdById: string
}

/**
 * The one key shape, org id first.
 *
 * 🛑 Both parts are required and neither is optional. See the file header.
 *
 * ⚠️ The prefix is also the first segment of the job's `jobId`
 * (`returnIntake:<org>:<draft>`), which is why it is a single token with no
 * colon of its own — BullMQ rejects a custom job id that does not split into
 * exactly three segments.
 */
export function returnIntakeDraftKey(organizationId: string, draftId: string): string {
  return `return-intake:${organizationId}:${draftId}`
}

/**
 * The stored record, or `null` when the key is gone.
 *
 * "Expired" and "never existed" are the same answer here, which is correct: the
 * review screen shows one message either way, and a draft that outlived its own
 * photos is not a draft.
 */
export async function readStoredReturnIntakeDraft(
  organizationId: string,
  draftId: string
): Promise<StoredReturnIntakeDraft | null> {
  const stored = await getRedisData(returnIntakeDraftKey(organizationId, draftId), true)
  if (!stored || typeof stored !== 'object') return null
  return stored as StoredReturnIntakeDraft
}

/** Strip the storage-only fields so callers get exactly the client contract. */
export function toReturnIntakeDraftView(stored: StoredReturnIntakeDraft): ReturnIntakeDraftView {
  return {
    id: stored.id,
    status: stored.status,
    phase: stored.phase,
    labelsRead: stored.labelsRead,
    labelsTotal: stored.labelsTotal,
    failureReason: stored.failureReason ?? null,
    payload: stored.payload,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  }
}

/**
 * One draft, org-scoped by its key.
 *
 * `NotFoundError` for a draft in another org, deliberately — the same answer a
 * draft that never existed gets, so an id probe learns nothing.
 */
export async function getReturnIntakeDraft(
  organizationId: string,
  draftId: string
): Promise<Result<ReturnIntakeDraftView, Error>> {
  return guard(
    async () => {
      const stored = await readStoredReturnIntakeDraft(organizationId, draftId)
      if (!stored) throw new NotFoundError('This label drop is no longer available')
      return toReturnIntakeDraftView(stored)
    },
    'Failed to read a return intake draft',
    { organizationId, draftId }
  )
}
