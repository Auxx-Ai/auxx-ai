// packages/lib/src/accounting/purchasing/bill-intake/run-store.ts

/**
 * The run store for a bill intake (plans/money/tasks/58 §4.3): Redis, 24 hours,
 * org in the key. Copies `intake/draft-queries.ts` / `intake/draft-mutations.ts`
 * mechanics exactly — see those files' headers for the reasoning this one does
 * not repeat.
 *
 * ## Why this is not a widened `IntakeDraftView`
 *
 * The bill run is a different shape (no nested `payload`, a `needs_vendor`
 * status the quote draft has no counterpart for, a pointer key the quote draft
 * has no counterpart for either), and `intake/draft-queries.ts` hardcodes its
 * own key prefix and result field name deliberately (see that file's §0.1
 * reasoning). Widening it would couple two features that should be free to
 * diverge.
 *
 * ## 🛑 The org id is IN THE KEY, same as the draft store
 *
 * Every read builds the full key from the CALLER'S OWN `organizationId`. A run
 * id leaked out of one org addresses a key that does not exist in another —
 * see `intake/draft-queries.ts`'s header for why there is deliberately no
 * `listRuns` and no lookup by run id alone.
 *
 * ## The pointer key
 *
 * `bill-intake:<organizationId>:bill:<vendorBillInstanceId>` -> `runId`, written
 * in the same step that marks the run `created` (§4.3), with the same TTL. It
 * lets the bill's page find the read that produced it with no query string, and
 * it expires together with the run it points at.
 *
 * No permission checks. The router asserts and calls in.
 */

import { deleteRedisData, getRedisData, setRedisData } from '@auxx/redis'
import type { RecordId } from '@auxx/types/resource'
import { generateId } from '@auxx/utils'
import type { Result } from 'neverthrow'
import { ConflictError, NotFoundError, UnprocessableEntityError } from '../../../errors'
import type { IntakeCandidate } from '../intake/client'
import { INTAKE_DRAFT_TTL_SECONDS } from '../intake/draft-queries'
import type { BillIntakePhase, BillIntakeRunView, BillIntakeWarning } from './client'
import { guard } from './guard'

/** The one run key shape, org id first. Both parts are required. */
export function billIntakeRunKey(organizationId: string, runId: string): string {
  return `bill-intake:${organizationId}:${runId}`
}

/**
 * The pointer key: what the bill's page uses to find the read that produced
 * it, with no query string. Expires together with the run key (§4.3).
 */
export function billIntakeRunPointerKey(
  organizationId: string,
  vendorBillInstanceId: string
): string {
  return `bill-intake:${organizationId}:bill:${vendorBillInstanceId}`
}

/** What is actually stored: the view, plus who may be offered it back. */
export interface StoredBillIntakeRun extends BillIntakeRunView {
  organizationId: string
  createdById: string
}

/** What starts a run: the uploaded invoice, and whatever the `choose` page carried. */
export interface CreateBillIntakeRunInput {
  /** `asset:<mediaAssetId>` from the temp upload. */
  assetRef: string
  fileName?: string | null
  mimeType?: string | null
  /** From the picker, when the person set one before uploading. */
  vendorRecordId?: RecordId | null
  /** From the picker, or from an order's Bills card. */
  purchaseOrderRecordId?: RecordId | null
}

/**
 * Open a run for one uploaded invoice.
 *
 * Returns immediately with `status: 'reading'`; the worker fills it in.
 */
export async function createBillIntakeRun(
  organizationId: string,
  userId: string,
  input: CreateBillIntakeRunInput
): Promise<Result<{ runId: string }, Error>> {
  return guard(
    async () => {
      const runId = generateId()
      const run: StoredBillIntakeRun = {
        id: runId,
        organizationId,
        createdById: userId,
        status: 'reading',
        phase: null,
        assetRef: input.assetRef,
        fileName: input.fileName ?? null,
        mimeType: input.mimeType ?? null,
        vendorRecordId: input.vendorRecordId ?? null,
        vendorCandidates: [],
        purchaseOrderRecordId: input.purchaseOrderRecordId ?? null,
        transcription: null,
        extractedText: null,
        proposals: null,
        warnings: [],
        vendorBillInstanceId: null,
        vendorBillRecordId: null,
        vendorBillLineRecordIds: [],
        existingBillRecordId: null,
        error: null,
        createdAt: new Date().toISOString(),
      }

      await setRedisData(
        billIntakeRunKey(organizationId, runId),
        run,
        INTAKE_DRAFT_TTL_SECONDS,
        true
      )

      return { runId }
    },
    'Failed to create a bill intake run',
    { organizationId, assetRef: input.assetRef }
  )
}

/**
 * The stored record, or `null` when the key is gone.
 *
 * "Expired" and "never existed" are the same answer here, on purpose — see
 * `intake/draft-queries.ts`'s `readStoredIntakeDraft` for why.
 */
export async function readStoredBillIntakeRun(
  organizationId: string,
  runId: string
): Promise<StoredBillIntakeRun | null> {
  const stored = await getRedisData(billIntakeRunKey(organizationId, runId), true)
  if (!stored || typeof stored !== 'object') return null
  return stored as StoredBillIntakeRun
}

/** Strip the storage-only fields so callers get exactly the client contract. */
export function toBillIntakeRunView(stored: StoredBillIntakeRun): BillIntakeRunView {
  return {
    id: stored.id,
    status: stored.status,
    phase: stored.phase ?? null,
    assetRef: stored.assetRef,
    fileName: stored.fileName ?? null,
    mimeType: stored.mimeType ?? null,
    vendorRecordId: stored.vendorRecordId ?? null,
    vendorCandidates: stored.vendorCandidates ?? [],
    purchaseOrderRecordId: stored.purchaseOrderRecordId ?? null,
    transcription: stored.transcription ?? null,
    extractedText: stored.extractedText ?? null,
    proposals: stored.proposals ?? null,
    warnings: stored.warnings ?? [],
    vendorBillInstanceId: stored.vendorBillInstanceId ?? null,
    vendorBillRecordId: stored.vendorBillRecordId ?? null,
    vendorBillLineRecordIds: stored.vendorBillLineRecordIds ?? [],
    existingBillRecordId: stored.existingBillRecordId ?? null,
    error: stored.error ?? null,
    createdAt: stored.createdAt,
  }
}

/**
 * One run, org-scoped by its key.
 *
 * `NotFoundError` for a run in another org, deliberately — the same answer a
 * run that never existed gets, so an id probe learns nothing.
 */
export async function getBillIntakeRun(
  organizationId: string,
  runId: string
): Promise<Result<BillIntakeRunView, Error>> {
  return guard(
    async () => {
      const stored = await readStoredBillIntakeRun(organizationId, runId)
      if (!stored) throw new NotFoundError('Invoice read not found')
      return toBillIntakeRunView(stored)
    },
    'Failed to read a bill intake run',
    { organizationId, runId }
  )
}

/**
 * The run behind a bill, via the pointer key — or `null` when either key is
 * gone. The page uses this to find the read that produced a bill without a
 * query string; a bill older than 24 hours simply has no run, and that is not
 * an error (§4.3).
 */
export async function getBillIntakeRunForBill(
  organizationId: string,
  vendorBillInstanceId: string
): Promise<Result<BillIntakeRunView | null, Error>> {
  return guard(
    async () => {
      const runId = await getRedisData(
        billIntakeRunPointerKey(organizationId, vendorBillInstanceId),
        true
      )
      if (!runId || typeof runId !== 'string') return null

      const stored = await readStoredBillIntakeRun(organizationId, runId)
      if (!stored) return null
      return toBillIntakeRunView(stored)
    },
    'Failed to read a bill intake run for a bill',
    { organizationId, vendorBillInstanceId }
  )
}

/**
 * Read, merge, re-`SETEX`.
 *
 * 🛑 Refuses a run already marked `created`, unless the patch itself is what
 * marks it `created` again (an idempotent retry). That run's pointer key
 * already leads to a real vendor bill, and letting a late job or a stale tab
 * write over it would make the reading page disagree with the bill it
 * produced — the same guard `intake/draft-mutations.ts`'s `updateDraft`
 * applies to a `committed` draft.
 */
export async function updateBillIntakeRun(
  organizationId: string,
  runId: string,
  patch: Partial<StoredBillIntakeRun>
): Promise<Result<void, Error>> {
  return guard(
    async () => {
      const stored = await readStoredBillIntakeRun(organizationId, runId)
      if (!stored) throw new NotFoundError('Invoice read not found')
      if (stored.status === 'created' && patch.status !== 'created') {
        throw new ConflictError(
          `This invoice is already vendor bill ${stored.vendorBillRecordId ?? 'that was created earlier'}`,
          { vendorBillInstanceId: stored.vendorBillInstanceId ?? undefined }
        )
      }

      await setRedisData(
        billIntakeRunKey(organizationId, runId),
        { ...stored, ...patch },
        INTAKE_DRAFT_TTL_SECONDS,
        true
      )
    },
    'Failed to update a bill intake run',
    { organizationId, runId }
  )
}

/**
 * Tick the read's progress.
 *
 * The dialog renders the whole phase list up front and marks each one done, so
 * a wait reads as progress rather than as a spinner. Never touches `status`.
 */
export async function setBillIntakeRunPhase(
  organizationId: string,
  runId: string,
  phase: BillIntakePhase
): Promise<Result<void, Error>> {
  return updateBillIntakeRun(organizationId, runId, { phase })
}

/**
 * Stop the run for a person to name the vendor.
 *
 * Not a failure: `needs_vendor` is a status, and nothing is created until it
 * is answered (§4.1 step 2, §4.2).
 */
export async function parkBillIntakeRunForVendor(
  organizationId: string,
  runId: string,
  candidates: IntakeCandidate[]
): Promise<Result<void, Error>> {
  return updateBillIntakeRun(organizationId, runId, {
    status: 'needs_vendor',
    vendorCandidates: candidates,
  })
}

/**
 * Answer a parked run with a vendor and let the job carry on.
 *
 * 🛑 Refuses (`UnprocessableEntityError`) unless the run is actually
 * `needs_vendor` — resuming a run that is not waiting on anything would let a
 * stale tab redirect a `reading` or `failed` run onto a vendor nobody chose for
 * it. This precondition is stricter than {@link updateBillIntakeRun}'s own
 * conflict guard (which only ever refuses writing over `created`), so it reads
 * and checks for itself rather than delegating.
 */
export async function resumeBillIntakeRun(
  organizationId: string,
  runId: string,
  vendorRecordId: RecordId
): Promise<Result<void, Error>> {
  return guard(
    async () => {
      const stored = await readStoredBillIntakeRun(organizationId, runId)
      if (!stored) throw new NotFoundError('Invoice read not found')
      if (stored.status !== 'needs_vendor') {
        throw new UnprocessableEntityError('This invoice read is not waiting on a vendor', {
          status: stored.status,
        })
      }

      await setRedisData(
        billIntakeRunKey(organizationId, runId),
        { ...stored, vendorRecordId, status: 'reading', error: null },
        INTAKE_DRAFT_TTL_SECONDS,
        true
      )
    },
    'Failed to resume a bill intake run',
    { organizationId, runId }
  )
}

/**
 * The read failed, and the dialog says why.
 *
 * `existingBillRecordId` carries the duplicate refusal's pointer (§4.2) so the
 * dialog can offer "Open that bill"; omitted (rather than passed `null`) for
 * every other refusal, so it is never clobbered back to `null` by a message
 * that has nothing to do with a duplicate.
 */
export async function failBillIntakeRun(
  organizationId: string,
  runId: string,
  message: string,
  existingBillRecordId?: RecordId | null
): Promise<Result<void, Error>> {
  return updateBillIntakeRun(organizationId, runId, {
    status: 'failed',
    error: message,
    ...(existingBillRecordId !== undefined ? { existingBillRecordId } : {}),
  })
}

/** What the create step (§4.4) produced, for {@link markBillIntakeRunCreated}. */
export interface BillIntakeRunCreatedResult {
  vendorBillInstanceId: string
  vendorBillRecordId: RecordId
  vendorBillLineRecordIds: RecordId[]
  /** Warnings discovered while creating the bill, shown by the bill page. */
  warnings?: BillIntakeWarning[]
}

/**
 * The job's last act: the bill exists, and the pointer key lets its page find
 * this run.
 *
 * The run write happens first, then the pointer, both on the same TTL so they
 * expire together. A failure between the two leaves a created bill with no
 * discoverable run — recoverable, since the bill already stands on its own
 * record (§1.3); it just loses the read banner.
 */
export async function markBillIntakeRunCreated(
  organizationId: string,
  runId: string,
  result: BillIntakeRunCreatedResult
): Promise<Result<void, Error>> {
  const updated = await updateBillIntakeRun(organizationId, runId, {
    status: 'created',
    phase: 'bill',
    error: null,
    vendorBillInstanceId: result.vendorBillInstanceId,
    vendorBillRecordId: result.vendorBillRecordId,
    vendorBillLineRecordIds: result.vendorBillLineRecordIds,
    ...(result.warnings ? { warnings: result.warnings } : {}),
  })
  if (updated.isErr()) return updated

  return guard(
    async () => {
      await setRedisData(
        billIntakeRunPointerKey(organizationId, result.vendorBillInstanceId),
        runId,
        INTAKE_DRAFT_TTL_SECONDS,
        true
      )
    },
    'Failed to write the bill intake pointer key',
    { organizationId, runId, vendorBillInstanceId: result.vendorBillInstanceId }
  )
}

/**
 * Drop the run.
 *
 * The dialog's Try again / Cancel from `failed` or `reading`. `required: true`
 * here too: a discard that silently no-ops leaves a dead run the dialog thinks
 * it cleared.
 */
export async function discardBillIntakeRun(
  organizationId: string,
  runId: string
): Promise<Result<void, Error>> {
  return guard(
    async () => {
      await deleteRedisData(billIntakeRunKey(organizationId, runId), true)
    },
    'Failed to discard a bill intake run',
    { organizationId, runId }
  )
}
