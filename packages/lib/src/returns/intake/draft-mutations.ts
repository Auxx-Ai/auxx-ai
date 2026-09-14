// packages/lib/src/returns/intake/draft-mutations.ts

/**
 * Writes over the return-intake draft (plans/money/tasks/57 §6.1, §6.2).
 *
 * 🛑 A draft is INERT. Nothing downstream reads one until the review screen's
 * commit turns it into returns, which is why it is not a `return` with
 * `status: 'requested'` — that would mint an `RMA-…` number through the
 * RecordSequence hook, appear in every list, and leave a numbering gap behind
 * every pallet somebody photographed twice. *"A plan the user abandons at the
 * preview must leave no records behind."*
 *
 * ## Three properties of this file that are load-bearing
 *
 * 1. 🛑 **The org id is in the key** (`returnIntakeDraftKey`), and the key prefix
 *    IS the org scope — there is no row-level filter behind it. Every write here
 *    reads through `readStoredReturnIntakeDraft(organizationId, …)` first, so a
 *    draft id from another org resolves to nothing rather than to somebody
 *    else's dock.
 * 2. ⚠️ **Every write passes `required: true`.** `setRedisData` SWALLOWS its
 *    errors and returns `null` otherwise, and a draft write that silently
 *    no-ops leaves the review screen loading forever with nothing anywhere
 *    saying why. With `required`, the throw reaches `guard` and comes back as an
 *    `err()`.
 * 3. **Every write re-stamps the TTL.** `SETEX` does this naturally, and it is
 *    the reason a draft somebody is actively reviewing does not expire under
 *    them mid-review. The clock restarts from the last edit, not from the
 *    upload — and a dock review with twenty labels on it is not a fast read.
 *
 * ## ⚠️ Per-label writes, never one batch at the end
 *
 * {@link recordReturnIntakeLabelRead} exists as its own writer because
 * `plans/money/tasks/38` §11.2 found that writing each item onto the draft the
 * moment it returned was what made a run that died late still worth looking at.
 * Ten labels are ten model calls (§3.1); batching them into one write at the end
 * means a crash on label nine throws away eight good transcriptions and leaves
 * the dialog with nothing to show for forty seconds of waiting.
 *
 * No permission checks. The router asserts and calls in.
 */

import { deleteRedisData, setRedisData } from '@auxx/redis'
import type { RecordId } from '@auxx/types/resource'
import { generateId } from '@auxx/utils'
import type { Result } from 'neverthrow'
import { ConflictError, NotFoundError } from '../../errors'
import {
  EMPTY_TRANSCRIBED_LABEL,
  RETURN_INTAKE_TIER_RANK,
  type ReturnIntakeCandidate,
  type ReturnIntakeDraftPhase,
  type ReturnIntakeLabel,
  type ReturnIntakeOrderOption,
  type ReturnIntakeTier,
  type TranscribedLabel,
} from './client'
import {
  RETURN_INTAKE_DRAFT_TTL_SECONDS,
  readStoredReturnIntakeDraft,
  returnIntakeDraftKey,
  type StoredReturnIntakeDraft,
} from './draft-queries'
import { guard } from './guard'

/** One photographed label, as the upload hands it over. */
export interface ReturnIntakeDraftLabelInput {
  /** `asset:<mediaAssetId>` from the `CUSTOM_FIELD` temp-upload door (§1.2). */
  fileRef: string
  fileName: string
}

/** What starts a draft: the photos, and nothing else yet. */
export interface CreateReturnIntakeDraftInput {
  labels: ReturnIntakeDraftLabelInput[]
}

/**
 * The strongest tier among a label's candidates.
 *
 * 🛑 A RANKING and a BADGE, never a branch in a writer — `client.ts` says why:
 * nothing auto-links, because a mis-linked return silently attaches one
 * customer's goods to another customer's order and the over-return guard then
 * computes its ceiling against the wrong order.
 */
export function bestTierOf(candidates: ReturnIntakeCandidate[]): ReturnIntakeTier {
  let best: ReturnIntakeTier = 'none'
  for (const candidate of candidates) {
    if (RETURN_INTAKE_TIER_RANK[candidate.tier] > RETURN_INTAKE_TIER_RANK[best]) {
      best = candidate.tier
    }
  }
  return best
}

/**
 * Open a draft with one slot per photographed label.
 *
 * Returns immediately with `status: 'reading'` and `labelsTotal` already known —
 * the upload has closed by the time this is called, so the dialog can render
 * "3 of 10" rather than an unbounded spinner (§6.2). The job fills the slots in.
 *
 * The label ids are minted here rather than by the caller because they are what
 * ties the photo, the transcription, the candidates and the worker's answer
 * together for the rest of the draft's life.
 */
export async function createReturnIntakeDraft(
  organizationId: string,
  userId: string,
  input: CreateReturnIntakeDraftInput
): Promise<Result<{ draftId: string }, Error>> {
  return guard(
    async () => {
      const draftId = generateId()
      const now = new Date().toISOString()

      const labels: ReturnIntakeLabel[] = input.labels.map((label) => ({
        id: generateId(),
        fileRef: label.fileRef,
        fileName: label.fileName,
        transcription: null,
        error: null,
        candidates: [],
        bestTier: 'none',
        looksOutbound: false,
        confirmedContactRecordId: null,
        confirmedOrderRecordId: null,
        confirmedUnidentified: false,
      }))

      const draft: StoredReturnIntakeDraft = {
        id: draftId,
        organizationId,
        createdById: userId,
        status: 'reading',
        phase: 'reading',
        labelsRead: 0,
        labelsTotal: labels.length,
        failureReason: null,
        payload: { labels, orderOptions: {} },
        createdAt: now,
        updatedAt: now,
      }

      await setRedisData(
        returnIntakeDraftKey(organizationId, draftId),
        draft,
        RETURN_INTAKE_DRAFT_TTL_SECONDS,
        true
      )

      return { draftId }
    },
    'Failed to create a return intake draft',
    { organizationId, labels: input.labels.length }
  )
}

/**
 * Read, merge, re-`SETEX`.
 *
 * Deliberately NOT a compare-and-set, for `purchasing/intake`'s reason: the two
 * writers are the job (phases and transcriptions) and the review screen
 * (confirmations), and they do not overlap — the screen only opens once the job
 * has marked the draft `ready`. A CAS whose contention case cannot occur is
 * machinery that will never be exercised or trusted.
 *
 * 🛑 Refuses a draft already marked `committed`. That draft points at real RMAs,
 * and letting a late job or a stale tab write over its payload would make the
 * review screen disagree with the returns it produced.
 */
async function updateDraft(
  organizationId: string,
  draftId: string,
  patch: (stored: StoredReturnIntakeDraft) => Partial<StoredReturnIntakeDraft>,
  logMessage: string
): Promise<Result<void, Error>> {
  return guard(
    async () => {
      const stored = await readStoredReturnIntakeDraft(organizationId, draftId)
      if (!stored) throw new NotFoundError('This label drop is no longer available')
      const changes = patch(stored)
      if (stored.status === 'committed' && changes.status !== 'committed') {
        throw new ConflictError('These labels have already been made into returns')
      }

      await setRedisData(
        returnIntakeDraftKey(organizationId, draftId),
        { ...stored, ...changes, updatedAt: new Date().toISOString() },
        RETURN_INTAKE_DRAFT_TTL_SECONDS,
        true
      )
    },
    logMessage,
    { organizationId, draftId }
  )
}

/** Replace one label in place, leaving the others exactly as they are. */
function patchLabel(
  stored: StoredReturnIntakeDraft,
  labelId: string,
  change: (label: ReturnIntakeLabel) => ReturnIntakeLabel
): Partial<StoredReturnIntakeDraft> {
  let found = false
  const labels = stored.payload.labels.map((label) => {
    if (label.id !== labelId) return label
    found = true
    return change(label)
  })
  if (!found) throw new NotFoundError('That label is not part of this drop')
  return { payload: { ...stored.payload, labels } }
}

/**
 * Tick the read's progress.
 *
 * The dialog renders `RETURN_INTAKE_PHASES` as a checklist and marks each one
 * done, so a twenty-label wait reads as progress rather than as a spinner.
 */
export async function setReturnIntakeDraftPhase(
  organizationId: string,
  draftId: string,
  phase: ReturnIntakeDraftPhase
): Promise<Result<void, Error>> {
  return updateDraft(
    organizationId,
    draftId,
    () => ({ phase }),
    'Failed to set return intake draft phase'
  )
}

/**
 * Record what the model read off ONE label, the moment the call returns.
 *
 * ⚠️ Per label and never batched — see the file header. `labelsRead` ticks here
 * too, and it ticks for a FAILED label as well as a good one: the counter is
 * "how many of the ten are done", not "how many worked", and a failure that did
 * not advance it would stall the dialog's `n of m` on a label nobody is still
 * waiting for.
 *
 * A label the model could not read is not an error state for the draft — the
 * review screen puts the photo beside empty fields and a person types them in
 * (§4.6). `error` is for a label whose CALL failed, which is a different thing
 * from `transcription.legible === false`, a label the model looked at and could
 * not make out.
 */
export async function recordReturnIntakeLabelRead(
  organizationId: string,
  draftId: string,
  labelId: string,
  outcome: { transcription: TranscribedLabel } | { error: string }
): Promise<Result<void, Error>> {
  return updateDraft(
    organizationId,
    draftId,
    (stored) => ({
      ...patchLabel(stored, labelId, (label) => ({
        ...label,
        transcription: 'transcription' in outcome ? outcome.transcription : label.transcription,
        error: 'error' in outcome ? outcome.error : null,
      })),
      labelsRead: Math.min(stored.labelsRead + 1, stored.labelsTotal),
    }),
    'Failed to record a transcribed return label'
  )
}

/**
 * What a person at the dock may type in when the model could not read the label.
 *
 * ⚠️ **Partial by construction.** A worker can often read the street off a
 * crumpled label and not the name, so every key is optional and only the keys
 * actually present are written. An absent key leaves whatever is there alone; an
 * explicit `null` (or an empty string) clears that one field.
 *
 * 🛑 Two fields of {@link TranscribedLabel} are deliberately NOT here:
 *
 * - `legible` is the MODEL'S OWN ANSWER to "could I read this", and no client may
 *   write it. See {@link patchReturnIntakeLabelTranscription}.
 * - `recipientNameRaw` feeds §4.7's outbound check, which `resolve.ts` already
 *   ran and stored as `looksOutbound`. Editing it here would change a string
 *   nothing reads again and imply the warning had been re-evaluated.
 */
export interface ReturnIntakeTranscriptionPatch {
  senderName?: string | null
  senderStreet1?: string | null
  senderStreet2?: string | null
  senderCity?: string | null
  senderRegion?: string | null
  senderPostalCode?: string | null
  senderCountry?: string | null
  carrier?: string | null
  trackingNumber?: string | null
  ourReferenceRaw?: string | null
}

const PATCHABLE_LABEL_FIELDS = [
  'senderName',
  'senderStreet1',
  'senderStreet2',
  'senderCity',
  'senderRegion',
  'senderPostalCode',
  'senderCountry',
  'carrier',
  'trackingNumber',
  'ourReferenceRaw',
] as const satisfies readonly (keyof ReturnIntakeTranscriptionPatch)[]

/** `schema.ts`'s rule, restated for typed input: trimmed, and blank IS null. */
function patchedText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Type the label in by hand, when the model could not read it (§4.6).
 *
 * Without this a worker who confirms an unreadable label as "not one of ours"
 * creates a return with an EMPTY `senderNameRaw` and `senderAddressRaw` —
 * §4.6 requires both to be filled from the label, and the unannounced pallet is
 * the case this whole feature exists for. `commit.ts` reads
 * `label.transcription`, so the typed values have to land there and nowhere else.
 *
 * 🛑 **`legible` is never written here, and that is the provenance marker.**
 * It is the model's own answer, and flipping it to `true` because a person typed
 * something would relabel their reading as the model's — on the one screen whose
 * whole job is telling a crumpled photo apart from a clean label with an unknown
 * sender (§3.2). So the model's answer is preserved verbatim, the typed values
 * sit beside it, and the review screen renders the two blocks differently:
 * `legible: true` is the model's read-only transcription, anything else is the
 * editable panel that says plainly it is not the model's reading. The person's
 * typing is never presented as a machine read, and clearing every field again
 * returns the card to "nothing could be read" rather than stranding it in a state
 * with no way back.
 *
 * ⚠️ A label with no transcription at all — the model's call FAILED, so there is
 * an `error` and nothing else — starts from {@link EMPTY_TRANSCRIBED_LABEL},
 * which carries `legible: false`. That is the honest reading of a call that never
 * produced one, and it puts the label on the same editable path rather than
 * leaving it the only kind that cannot be typed in.
 */
export async function patchReturnIntakeLabelTranscription(
  organizationId: string,
  draftId: string,
  labelId: string,
  patch: ReturnIntakeTranscriptionPatch
): Promise<Result<void, Error>> {
  return updateDraft(
    organizationId,
    draftId,
    (stored) =>
      patchLabel(stored, labelId, (label) => {
        // 🛑 Merged over what is there, never a replacement. A worker who reads
        // the street and not the name sends one key, and the other nine — the
        // model's, or an earlier pass of their own — must survive it.
        const merged: TranscribedLabel = { ...(label.transcription ?? EMPTY_TRANSCRIBED_LABEL) }
        for (const field of PATCHABLE_LABEL_FIELDS) {
          if (!(field in patch)) continue
          merged[field] = patchedText(patch[field])
        }
        return { ...label, transcription: merged }
      }),
    'Failed to patch a return label transcription'
  )
}

/**
 * Record the ladder's answers for one label.
 *
 * `bestTier` is derived here rather than taken from the caller so the badge on
 * screen and the ordering in the picker can never disagree with the candidate
 * list they are drawn from.
 *
 * 🛑 `looksOutbound` is carried, not acted on. §4.7: it means the recipient
 * matches our own business name and the sender does not, which is a WARNING on
 * the review screen and never a refusal — a worker may legitimately be returning
 * something to a vendor.
 */
export async function recordReturnIntakeLabelCandidates(
  organizationId: string,
  draftId: string,
  labelId: string,
  input: { candidates: ReturnIntakeCandidate[]; looksOutbound?: boolean }
): Promise<Result<void, Error>> {
  return updateDraft(
    organizationId,
    draftId,
    (stored) =>
      patchLabel(stored, labelId, (label) => ({
        ...label,
        candidates: input.candidates,
        bestTier: bestTierOf(input.candidates),
        looksOutbound: input.looksOutbound ?? label.looksOutbound,
      })),
    'Failed to record return label candidates'
  )
}

/**
 * The worker's answer for one label. The ONLY fields the review screen writes.
 *
 * 🛑 `unidentified: true` is a decision and is NOT the same as a null contact.
 * A null `confirmedContactRecordId` means undecided; `confirmedUnidentified`
 * means a person looked at the label and said this sender is not one of ours
 * (§4.6). The grouper needs the difference: an undecided label is not ready to
 * commit, an unidentified one is, and it becomes its own group.
 */
export async function confirmReturnIntakeLabel(
  organizationId: string,
  draftId: string,
  input: {
    labelId: string
    contactRecordId: RecordId | null
    orderRecordId: RecordId | null
    unidentified: boolean
  }
): Promise<Result<void, Error>> {
  return updateDraft(
    organizationId,
    draftId,
    (stored) =>
      patchLabel(stored, input.labelId, (label) => ({
        ...label,
        // An unidentified label carries no contact and no order by definition.
        confirmedContactRecordId: input.unidentified ? null : input.contactRecordId,
        confirmedOrderRecordId: input.unidentified ? null : input.orderRecordId,
        confirmedUnidentified: input.unidentified,
      })),
    'Failed to confirm a return intake label'
  )
}

/**
 * Cache the orders a confirmed contact could be returning against (§4.5).
 *
 * Keyed by `contactRecordId` rather than by label, because two labels confirmed
 * to the same customer ask the same question and the answer is the same list.
 */
export async function setReturnIntakeOrderOptions(
  organizationId: string,
  draftId: string,
  contactRecordId: RecordId,
  options: ReturnIntakeOrderOption[]
): Promise<Result<void, Error>> {
  return updateDraft(
    organizationId,
    draftId,
    (stored) => ({
      payload: {
        ...stored.payload,
        orderOptions: { ...stored.payload.orderOptions, [contactRecordId]: options },
      },
    }),
    'Failed to store return intake order options'
  )
}

/** The job's last act: every label has been read and matched, the review may open. */
export async function markReturnIntakeDraftReady(
  organizationId: string,
  draftId: string
): Promise<Result<void, Error>> {
  return updateDraft(
    organizationId,
    draftId,
    () => ({ status: 'ready', phase: 'ready', failureReason: null }),
    'Failed to mark a return intake draft ready'
  )
}

/**
 * The read failed, and the dialog says why.
 *
 * `message` is shown verbatim, so it is written for the person standing at the
 * dock — "Pick another default model", not a stack frame.
 */
export async function failReturnIntakeDraft(
  organizationId: string,
  draftId: string,
  message: string
): Promise<Result<void, Error>> {
  return updateDraft(
    organizationId,
    draftId,
    () => ({ status: 'failed', failureReason: message }),
    'Failed to mark a return intake draft failed'
  )
}

/**
 * Take the labels that became real returns out of the draft.
 *
 * 🛑 This is the idempotency guard AND the partial-failure record, and it is one
 * write for both because they are the same fact. Commit is per group (§6.3):
 * three groups and the second refuses means the first is already an `RMA-…` that
 * exists. Removing exactly the committed labels leaves the draft holding the
 * ones that failed, so the worker retries *those* and a second press of Create
 * cannot mint a second RMA for a parcel that already has one — the group's
 * labels are simply no longer there to group.
 *
 * The draft goes `committed` only when nothing is left. 🛑 The key is never
 * deleted: a delete that failed — a Redis blip, a pod restart — would leave a
 * draft still reading `ready` over returns that already exist, and a retry would
 * raise a duplicate RMA for goods that are already booked in. The 24-hour TTL
 * reaps it, and until it does the draft says exactly what happened to it.
 */
export async function recordReturnIntakeCommit(
  organizationId: string,
  draftId: string,
  committedLabelIds: string[]
): Promise<Result<void, Error>> {
  const committed = new Set(committedLabelIds)
  return updateDraft(
    organizationId,
    draftId,
    (stored) => {
      const labels = stored.payload.labels.filter((label) => !committed.has(label.id))
      return {
        payload: { ...stored.payload, labels },
        ...(labels.length === 0 ? { status: 'committed' as const } : {}),
      }
    },
    'Failed to record a return intake commit'
  )
}

/**
 * Drop the draft.
 *
 * The review screen's Discard, and the ONLY deleter. 🛑 The commit does not use
 * it — see {@link recordReturnIntakeCommit}. The photos behind a discarded draft
 * are on their own 24-hour fuse and the upload sweep collects them.
 *
 * `required: true` here too: a discard that silently no-ops leaves a review
 * route the worker thought they had thrown away still answering.
 */
export async function discardReturnIntakeDraft(
  organizationId: string,
  draftId: string
): Promise<Result<void, Error>> {
  return guard(
    async () => {
      await deleteRedisData(returnIntakeDraftKey(organizationId, draftId), true)
    },
    'Failed to discard a return intake draft',
    { organizationId, draftId }
  )
}
