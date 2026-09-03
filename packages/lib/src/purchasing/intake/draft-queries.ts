// packages/lib/src/purchasing/intake/draft-queries.ts

/**
 * Reads over the intake draft (plans/money/tasks/38 §6.1).
 *
 * ## Why Redis and not a table
 *
 * A draft has no query surface — there is deliberately no `listDrafts`, because
 * finding an in-flight draft is a `localStorage` pointer the browser keeps. It
 * has no reporting, no joins, no retention requirement, and its TTL IS its whole
 * lifecycle policy. A `SETEX` gives that for free and deletes the sweep job
 * outright; a table would have needed a sweep to reproduce it. The direct
 * precedent is `files/upload/session.ts`, which already keeps in-flight upload
 * state exactly this way.
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
 * No permission checks. The router asserts view on `purchase_order` and calls in.
 */

import { getRedisData } from '@auxx/redis'
import type { Result } from 'neverthrow'
import { NotFoundError } from '../../errors'
import { TEMP_ASSET_TTL_MS } from '../../files/upload/handlers/shared'
import type { IntakeDraftView } from './client'
import { guard } from './guard'

/**
 * How long a draft survives, derived from the temp upload's own window.
 *
 * 🛑 Never a hardcoded `86400`. The draft and the asset it describes must expire
 * together: if the asset went first the review screen would come back with a
 * live table beside a dead document pane, which is worse than the draft simply
 * being gone. Deriving it is what stops the two drifting apart.
 */
export const INTAKE_DRAFT_TTL_SECONDS = Math.floor(TEMP_ASSET_TTL_MS / 1000)

/** What is actually stored: the view, plus who may be offered it back. */
export interface StoredIntakeDraft extends IntakeDraftView {
  organizationId: string
  createdById: string
}

/**
 * The one key shape, org id first.
 *
 * 🛑 Both parts are required and neither is optional. See the file header.
 */
export function intakeDraftKey(organizationId: string, draftId: string): string {
  return `purchase-intake:${organizationId}:${draftId}`
}

/**
 * The stored record, or `null` when the key is gone.
 *
 * "Expired" and "never existed" are the same answer here, which is correct: the
 * review screen shows one message either way, and a draft that outlived its own
 * document is not a draft.
 */
export async function readStoredIntakeDraft(
  organizationId: string,
  draftId: string
): Promise<StoredIntakeDraft | null> {
  const stored = await getRedisData(intakeDraftKey(organizationId, draftId), true)
  if (!stored || typeof stored !== 'object') return null
  return stored as StoredIntakeDraft
}

/** Strip the storage-only fields so callers get exactly the client contract. */
export function toIntakeDraftView(stored: StoredIntakeDraft): IntakeDraftView {
  return {
    id: stored.id,
    status: stored.status,
    phase: stored.phase ?? null,
    assetRef: stored.assetRef,
    fileName: stored.fileName ?? null,
    mimeType: stored.mimeType ?? null,
    extractedText: stored.extractedText ?? null,
    payload: stored.payload ?? null,
    error: stored.error ?? null,
    purchaseOrderInstanceId: stored.purchaseOrderInstanceId ?? null,
    createdAt: stored.createdAt,
  }
}

/**
 * One draft, org-scoped by its key.
 *
 * `NotFoundError` for a draft in another org, deliberately — the same answer a
 * draft that never existed gets, so an id probe learns nothing.
 */
export async function getIntakeDraft(
  organizationId: string,
  draftId: string
): Promise<Result<IntakeDraftView, Error>> {
  return guard(
    async () => {
      const stored = await readStoredIntakeDraft(organizationId, draftId)
      if (!stored) throw new NotFoundError('Quote draft not found')
      return toIntakeDraftView(stored)
    },
    'Failed to read a purchase intake draft',
    { organizationId, draftId }
  )
}
