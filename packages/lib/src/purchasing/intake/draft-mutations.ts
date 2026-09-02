// packages/lib/src/purchasing/intake/draft-mutations.ts

/**
 * Writes over the intake draft (plans/money/tasks/38 §6.1).
 *
 * 🛑 A draft is INERT. Nothing downstream reads one until the review screen's
 * commit turns it into records, which is why it is not a `purchase_order` with
 * `status: 'draft'` — that would mint a RecordSequence number, appear in every
 * list, and leave a numbering gap behind every abandoned quote. "A plan the user
 * abandons at the preview must leave no records behind."
 *
 * ## Three properties of this file that are load-bearing
 *
 * 1. 🛑 **The org id is in the key** (`intakeDraftKey`), and the key prefix IS
 *    the org scope — there is no row-level filter behind it. Every write here
 *    reads through `readStoredIntakeDraft(organizationId, …)` first, so a draft
 *    id from another org resolves to nothing rather than to somebody else's
 *    quote.
 * 2. ⚠️ **Every write passes `required: true`.** `setRedisData` SWALLOWS its
 *    errors and returns `null` otherwise, and a draft write that silently
 *    no-ops leaves the review screen loading forever with nothing anywhere
 *    saying why. With `required`, the throw reaches `guard` and comes back as an
 *    `err()`.
 * 3. **Every write re-stamps the TTL.** `SETEX` does this naturally, and it is
 *    the reason a draft somebody is actively editing does not expire under them
 *    mid-review. The clock restarts from the last edit, not from the upload.
 *
 * No permission checks. The router asserts and calls in.
 */

import { deleteRedisData, setRedisData } from '@auxx/redis'
import { generateId } from '@auxx/utils'
import type { Result } from 'neverthrow'
import { ConflictError, NotFoundError } from '../../errors'
import type { IntakeDraftPayload, IntakeDraftPhase } from './client'
import {
  INTAKE_DRAFT_TTL_SECONDS,
  intakeDraftKey,
  readStoredIntakeDraft,
  type StoredIntakeDraft,
} from './draft-queries'
import { guard } from './guard'

/** What starts a draft: the uploaded quote, and nothing else yet. */
export interface CreateIntakeDraftInput {
  /** `asset:<mediaAssetId>` from the temp upload. */
  assetRef: string
  fileName?: string | null
  mimeType?: string | null
}

/**
 * Open a draft for one uploaded quote.
 *
 * Returns immediately with `status: 'reading'`; the worker fills it in. The
 * browser stores the id as its own pointer (`INTAKE_POINTER_STORAGE_KEY`) so the
 * purchase orders page can offer the draft back after a closed tab.
 */
export async function createIntakeDraft(
  organizationId: string,
  userId: string,
  input: CreateIntakeDraftInput
): Promise<Result<{ draftId: string }, Error>> {
  return guard(
    async () => {
      const draftId = generateId()
      const draft: StoredIntakeDraft = {
        id: draftId,
        organizationId,
        createdById: userId,
        status: 'reading',
        phase: null,
        assetRef: input.assetRef,
        fileName: input.fileName ?? null,
        mimeType: input.mimeType ?? null,
        payload: null,
        error: null,
        purchaseOrderInstanceId: null,
        createdAt: new Date().toISOString(),
      }

      await setRedisData(
        intakeDraftKey(organizationId, draftId),
        draft,
        INTAKE_DRAFT_TTL_SECONDS,
        true
      )

      return { draftId }
    },
    'Failed to create a purchase intake draft',
    { organizationId, assetRef: input.assetRef }
  )
}

/**
 * Read, merge, re-`SETEX`.
 *
 * Deliberately NOT a compare-and-set. The two writers are the worker (phases,
 * then the finished proposal) and the review screen (payload saves), and they do
 * not overlap: the screen only opens once the job has marked the draft `ready`.
 * `files/upload/session.ts` needs its Lua CAS because concurrent part-completion
 * callbacks genuinely race; nothing here does, and a CAS whose contention case
 * cannot occur is machinery that will never be exercised or trusted.
 *
 * 🛑 Refuses a draft already marked `committed`. That draft points at a real
 * purchase order, and letting a late job or a stale tab write over its payload
 * would make the review screen disagree with the order it produced. The status
 * lives in the stored record precisely so this guard survives the move off a
 * table with a `WHERE status <> 'committed'` on it.
 */
async function updateDraft(
  organizationId: string,
  draftId: string,
  patch: Partial<StoredIntakeDraft>,
  logMessage: string
): Promise<Result<void, Error>> {
  return guard(
    async () => {
      const stored = await readStoredIntakeDraft(organizationId, draftId)
      if (!stored) throw new NotFoundError('Quote draft not found')
      if (stored.status === 'committed' && patch.status !== 'committed') {
        throw new ConflictError('This quote has already been made into a purchase order')
      }

      await setRedisData(
        intakeDraftKey(organizationId, draftId),
        { ...stored, ...patch },
        INTAKE_DRAFT_TTL_SECONDS,
        true
      )
    },
    logMessage,
    { organizationId, draftId }
  )
}

/**
 * Tick the read's progress.
 *
 * The dialog renders the whole phase list up front and marks each one done, so a
 * 40-second wait reads as progress rather than as a spinner.
 */
export async function setIntakeDraftPhase(
  organizationId: string,
  draftId: string,
  phase: IntakeDraftPhase
): Promise<Result<void, Error>> {
  return updateDraft(organizationId, draftId, { phase }, 'Failed to set intake draft phase')
}

/**
 * Replace the proposal, leaving the status alone.
 *
 * This is the review screen's save. It never promotes a `reading` draft, because
 * a save is a person editing what they can see and the job owns the transition.
 */
export async function updateIntakeDraftPayload(
  organizationId: string,
  draftId: string,
  payload: IntakeDraftPayload
): Promise<Result<void, Error>> {
  return updateDraft(organizationId, draftId, { payload }, 'Failed to update intake draft payload')
}

/** The job's last act: the proposal is complete and the review screen may open. */
export async function markIntakeDraftReady(
  organizationId: string,
  draftId: string,
  payload: IntakeDraftPayload
): Promise<Result<void, Error>> {
  return updateDraft(
    organizationId,
    draftId,
    { payload, status: 'ready', phase: 'draft', error: null },
    'Failed to mark an intake draft ready'
  )
}

/**
 * The read failed, and the dialog says why.
 *
 * `message` is shown verbatim, so it is written for the person who uploaded the
 * file — "Pick another default model", not a stack frame.
 */
export async function failIntakeDraft(
  organizationId: string,
  draftId: string,
  message: string
): Promise<Result<void, Error>> {
  return updateDraft(
    organizationId,
    draftId,
    { status: 'failed', error: message },
    'Failed to mark an intake draft failed'
  )
}

/**
 * Mark a draft as the purchase order it became.
 *
 * 🛑 This is the idempotency guard, and it is the reason the commit does NOT
 * delete the key. A delete that failed — a Redis blip, a timeout, a pod restart
 * — would leave a draft still reading `ready`, the review screen still editable,
 * and a retry would mint a SECOND purchase order for the same quote. Sending a
 * vendor two copies of the same order is the worst outcome this feature has.
 * A stored status cannot fail that way: the 24-hour TTL reaps the key, and until
 * it does the draft says exactly what happened to it.
 *
 * `commitIntakeDraft` is the only caller, and calls this the moment the order
 * and its lines exist — see the ordering comment there.
 */
export async function markIntakeDraftCommitted(
  organizationId: string,
  draftId: string,
  purchaseOrderInstanceId: string
): Promise<Result<void, Error>> {
  return updateDraft(
    organizationId,
    draftId,
    { status: 'committed', purchaseOrderInstanceId, error: null },
    'Failed to mark an intake draft committed'
  )
}

/**
 * Drop the draft.
 *
 * The review screen's Discard, and the ONLY deleter. 🛑 The commit does not use
 * it: a committed draft is marked, never removed, so that a failed delete can
 * never resurrect an editable draft over records that already exist. The asset
 * behind a discarded draft is on its own 24-hour fuse and the upload sweep
 * collects it.
 *
 * `required: true` here too: a discard that silently no-ops leaves the person's
 * `localStorage` pointer aimed at a draft they told us to throw away.
 */
export async function discardIntakeDraft(
  organizationId: string,
  draftId: string
): Promise<Result<void, Error>> {
  return guard(
    async () => {
      await deleteRedisData(intakeDraftKey(organizationId, draftId), true)
    },
    'Failed to discard a purchase intake draft',
    { organizationId, draftId }
  )
}
