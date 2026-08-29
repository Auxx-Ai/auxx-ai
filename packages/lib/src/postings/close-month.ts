// packages/lib/src/postings/close-month.ts
//
// The month-end close, composed. Both halves already existed and nothing joined
// them: `gatherMonthEndInventoryInputs` does the reads, `buildMonthEndInventoryEntry`
// does the arithmetic, and `previewEntry` / `postEntry` do the ledger. This file
// is the seam, and it exists for one reason - THREE ERROR IDIOMS MEET HERE AND
// EXACTLY ZERO OF THEM MAY REACH THE CALLER AS A THROW.
//
// ── The three idioms ────────────────────────────────────────────────────────
//
// | Step                          | How it refuses                      |
// | ----------------------------- | ----------------------------------- |
// | `gatherMonthEndInventoryInputs` | `err(AuxxError)` - a `Result`     |
// | `buildMonthEndInventoryEntry`   | THROWS `UnprocessableEntityError` |
// | `resolvePeriodLock`             | THROWS `UnprocessableEntityError` |
// | `previewEntry`                  | `EntryPreview.blockedBy`          |
// | `postEntry`                     | `PostResult.status` - never throws |
//
// The close console has exactly one treatment for a refusal: `entry-blockers.tsx`
// renders `preview.blockedBy` as an actionable line. So `previewMonthEnd` folds
// every idiom into `blockedBy` and `postMonthEnd` folds every idiom into a
// `PostResult` status. Neither throws for a business refusal. A genuinely
// unexpected internal fault still lands as status `error` - it does not escape.
//
// ── 🛑 The refusal MESSAGE is the product, and it is passed through verbatim ──
//
// `gatherMonthEndInventoryInputs` produces the single most useful sentence in
// this subsystem: it names the exact uncosted movement id, the exact missing
// setting, or the exact unpriced row to fix (task 09 section 4 requires an
// uncosted post-cutoff movement to fail the close and NAME ITSELF). Summarising
// that into "could not gather inputs" would throw away the whole design, so
// every conversion below copies `error.message` unchanged. Nothing here rewrites
// a message it did not write.
//
// ── The two refusals that are NOT failures ──────────────────────────────────
//
// `nothing_to_close` and `setup_incomplete` (`NON_FAILURE_REFUSALS` in
// `types.ts`) are the two most ordinary things an organization encounters, and
// before task 14 both could only land as `error` - indistinguishable from a
// crash. An org whose cutoff predates its first movement walks through a RUN of
// empty months; the console skips them. A draft setup is what every org hits on
// day one; the console links to the wizard. Neither is ever logged as an error,
// for the same reason `already_posted` is not: a channel that fires on routine
// outcomes is a channel nobody reads.
//
// ── 🛑 How an empty month is detected, and why not by its message ────────────
//
// `buildMonthEndInventoryEntry` throws `UnprocessableEntityError` when every
// lane is zero. Three discriminators were available and two of them are traps:
//
// 1. **The message text** (`/^Nothing moved in /`). Rejected - it couples this
//    file to a sentence somebody will reword the first time a customer finds it
//    unclear, and the coupling is invisible from the other end.
// 2. **The error's `details` shape.** That throw passes `{ periodKey }` while
//    the builder's other throws pass `{ field, value }`. Tempting, but NOT
//    unique: `buildEntry` - which the month-end builder calls - throws
//    `{ postingType, periodKey }` on "at least one line" and on an imbalance, so
//    the discriminator would have to be "exactly one key, named periodKey", and
//    an added key anywhere upstream silently breaks it.
// 3. **The INPUTS.** Chosen. An empty month is a fact about the data, not about
//    the error: if every one of the six lanes has `current === prior`, there is
//    no delta to assert and there is no entry, whatever the builder happened to
//    say. The check is consulted ONLY on the catch path, never before the call -
//    which is what makes it safe. A pre-check could preempt a build that would
//    have succeeded; a post-check cannot, because the builder has already
//    refused by the time it is asked.
//
// ── What is deliberately NOT here ───────────────────────────────────────────
//
// **The cutoff check.** `gatherMonthEndInventoryInputs` already refuses a period
// at or before `accounting.cutoffPeriod`, with a message that names the cutoff.
// Duplicating it here would put the same rule in two places with one copy able
// to drift.
//
// **A settings read.** `getOrganizationSetting` answers from the org cache, and
// nothing in a posting path should add a second, differently-timed read of the
// same values. `readOpeningBaseline` is reached exactly once, through `gather`,
// and this file never touches a setting directly. `resolvePeriodLock` is the one
// exception and it is the poster's own contract - `PostEntryOptions.lock` is
// resolved by the caller by design, so `periods.ts` can stay pure.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { AuxxError, UnprocessableEntityError } from '../errors'
import {
  type BuiltMonthEndInventoryDraft,
  buildMonthEndInventoryEntry,
  type MonthEndInventoryInputs,
} from './build-month-end-inventory'
import { gatherMonthEndInventoryInputs } from './gather-month-end-inventory'
import { resolvePeriodLock } from './period-lock'
import type { PeriodLock } from './periods'
import { postEntry, previewEntry } from './post-entry'
import { OPENING_BASELINE_SETTING_KEYS } from './setup-readiness'
import type { EntryPreview, PostFailureClass, PostResult, PostResultStatus } from './types'

const logger = createScopedLogger('postings:close-month')

/** The posting type this file closes. There is exactly one, under L1. */
const POSTING_TYPE = 'month_end_inventory' as const

export interface PreviewMonthEndOptions {
  organizationId: string
  /** The accounting MONTH being closed, `'2026-08'`. A day key is refused. */
  periodKey: string
}

export interface PostMonthEndOptions extends PreviewMonthEndOptions {
  actorUserId?: string
  memo?: string
}

/**
 * One refusal, in the only vocabulary both return shapes share.
 *
 * `txnDate` rides along because a refusal raised AFTER the entry was built knows
 * the period's real last day, and a preview that can show it should.
 */
interface CloseRefusal {
  status: PostResultStatus
  error: string
  failureClass?: PostFailureClass
  txnDate?: string
}

/** Everything a preview or a post needs, once nothing has refused. */
interface CloseReady {
  draft: BuiltMonthEndInventoryDraft
  lock: PeriodLock
}

type ClosePreparation = { refusal: CloseRefusal } | { ready: CloseReady }

/**
 * Preview the month-end inventory entry for one period. Writes NOTHING.
 *
 * Runs the same gather, the same arithmetic and the same role resolution a post
 * would, and returns what the entry would look like. Every refusal - a missing
 * setting, an uncosted movement, a month before the cutoff, an empty month, a
 * draft setup, a locked period, an unmapped role - arrives as
 * {@link EntryPreview.blockedBy} carrying the original message.
 *
 * **Never throws.** An unexpected internal fault returns a `blockedBy` of status
 * `error` rather than propagating.
 *
 * @param db The database handle. Reads only.
 * @param options The organization and the MONTH key to close, `'2026-08'`.
 * @returns The projected entry, with `blockedBy` set when it would refuse.
 */
export async function previewMonthEnd(
  db: Database,
  options: PreviewMonthEndOptions
): Promise<EntryPreview> {
  const { organizationId, periodKey } = options

  const prepared = await prepareClose(db, organizationId, periodKey)
  if ('refusal' in prepared) return refusalPreview(periodKey, prepared.refusal)

  const { draft, lock } = prepared.ready
  try {
    const preview = await previewEntry(db, { organizationId, entry: draft.entry, lock })
    // The assertions the entry WOULD carry, so the console can render its
    // roll-forward for an OPEN month rather than only after posting. They are
    // the same object `postMonthEnd` hands to the poster, not a second
    // derivation, so a preview and the post it precedes cannot disagree.
    return { ...preview, assertions: draft.assertions }
  } catch (error) {
    const refusal = unexpected(error, organizationId, periodKey)
    return refusalPreview(periodKey, { ...refusal, txnDate: draft.entry.txnDate })
  }
}

/**
 * Build, claim, persist and export the month-end inventory entry for one period.
 *
 * **Never throws.** Every outcome - including a refusal from any of the three
 * upstream error idioms - is a {@link PostResult} status, so a tRPC mutation or
 * a BullMQ job can record the result without its own try/catch.
 *
 * 🛑 The `assertions` the builder produced are threaded into `postEntry`.
 * `requiresAssertions` names `month_end_inventory`, so omitting them is a
 * refusal rather than a silent partial write: a month-end row claimed with no
 * assertions holds the period, cannot be repaired by a later run, and leaves the
 * NEXT close with nothing to compute its delta from - while balancing perfectly.
 *
 * @param db The database handle.
 * @param options The organization, the MONTH key, and who asked.
 * @returns What happened, as a status. `nothing_to_close` and `setup_incomplete`
 * are ordinary outcomes and must not be surfaced as errors.
 */
export async function postMonthEnd(
  db: Database,
  options: PostMonthEndOptions
): Promise<PostResult> {
  const { organizationId, periodKey, actorUserId, memo } = options

  const prepared = await prepareClose(db, organizationId, periodKey)
  if ('refusal' in prepared) return refusalResult(prepared.refusal)

  const { draft, lock } = prepared.ready
  try {
    return await postEntry(db, {
      organizationId,
      entry: draft.entry,
      lock,
      assertions: draft.assertions,
      actorUserId,
      memo,
    })
  } catch (error) {
    // `postEntry` documents that it never throws. This guard is here so that
    // promise stays a property of THIS function's contract rather than a
    // dependency on somebody else keeping theirs.
    return refusalResult(unexpected(error, organizationId, periodKey))
  }
}

// ── The shared front half ──────────────────────────────────────────────────

/**
 * Gather, build and resolve the lock - the three steps preview and post share.
 *
 * Kept in one function rather than duplicated so a refusal cannot be classified
 * one way on the screen and another way on the button.
 */
async function prepareClose(
  db: Database,
  organizationId: string,
  periodKey: string
): Promise<ClosePreparation> {
  let inputs: MonthEndInventoryInputs
  try {
    const gathered = await gatherMonthEndInventoryInputs(db, organizationId, periodKey)
    if (gathered.isErr()) return { refusal: classifyGatherError(gathered.error) }
    inputs = gathered.value
  } catch (error) {
    // `gather` owns a try/catch and returns a `Result`, so this is unreachable
    // today. It is here because the moment it becomes reachable, the failure it
    // produces is an unhandled rejection in a tRPC mutation.
    return { refusal: unexpected(error, organizationId, periodKey) }
  }

  let draft: BuiltMonthEndInventoryDraft
  try {
    draft = buildMonthEndInventoryEntry(inputs)
  } catch (error) {
    return { refusal: classifyBuildError(error, inputs) }
  }

  try {
    return { ready: { draft, lock: await resolvePeriodLock(organizationId) } }
  } catch (error) {
    return { refusal: classifyLockError(error, organizationId, periodKey, draft.entry.txnDate) }
  }
}

// ── Classification ─────────────────────────────────────────────────────────

/**
 * A gather refusal, mapped onto the status vocabulary. The MESSAGE is copied
 * verbatim in every branch - see the header.
 *
 * - The draft-setup gate becomes `setup_incomplete`. `readOpeningBaseline`
 *   already distinguishes it: it is the only refusal in the subsystem that
 *   attaches `setting: 'accounting.setupState'` to its details, and `gather`
 *   returns that error unwrapped. So this is a MAPPING, not new detection.
 * - The incomplete-baseline refusal (`finalized` with blank keys) ALSO becomes
 *   `setup_incomplete`, by coordinator decision 2026-08-28. It is an anomaly
 *   rather than a draft, but the remedy is the same wizard and the message names
 *   the exact blank rows, so reporting it as `error` would send an operator to
 *   the logs for a list already in their hands.
 * - The pre-cutoff refusal becomes `period_closed`. A month at or before
 *   `accounting.cutoffPeriod` is covered by the frozen opening balances and can
 *   never be closed by this system - which is what `period_closed` means. It is
 *   identified by `cutoffPeriod` in the details, which nothing else attaches.
 * - Everything else - an uncosted movement, an unpriced row, a missing opening
 *   balance - is `error`. Those are real conditions somebody has to repair, and
 *   the message names the exact row to repair.
 */
function classifyGatherError(error: Error): CloseRefusal {
  const details = error instanceof AuxxError ? error.details : undefined

  if (
    error instanceof UnprocessableEntityError &&
    details?.setting === OPENING_BASELINE_SETTING_KEYS.setupState
  ) {
    return { status: 'setup_incomplete', error: error.message, failureClass: 'configuration' }
  }

  // A baseline that says finalized while required keys are blank. An anomaly -
  // finalize is supposed to gate on completeness - but the remedy is the same
  // screen, so it gets the same status rather than `error`. `missing` is the
  // only refusal in the subsystem that attaches an array of setting keys, and
  // `readOpeningBaseline` is the only producer of it.
  if (error instanceof UnprocessableEntityError && Array.isArray(details?.missing)) {
    return { status: 'setup_incomplete', error: error.message, failureClass: 'configuration' }
  }

  if (error instanceof UnprocessableEntityError && details?.cutoffPeriod !== undefined) {
    return { status: 'period_closed', error: error.message, failureClass: 'configuration' }
  }

  return { status: 'error', error: error.message, failureClass: 'data' }
}

/**
 * A build throw, mapped onto the status vocabulary.
 *
 * The empty-month case is decided by the INPUTS, not by the error - see the
 * header for why the message and the details shape were both rejected as
 * discriminators. Everything else the builder throws is what its own header
 * calls a programmer error: a non-integer input, a missing snapshot half, or an
 * entry that will not balance. Those are `error`, with the field-naming message
 * intact.
 */
function classifyBuildError(error: unknown, inputs: MonthEndInventoryInputs): CloseRefusal {
  if (everyLaneUnchanged(inputs)) {
    return {
      status: 'nothing_to_close',
      error: error instanceof Error ? error.message : `Nothing moved in ${inputs.periodKey}`,
      txnDate: inputs.txnDate,
    }
  }

  return {
    status: 'error',
    error: error instanceof Error ? error.message : String(error),
    failureClass: 'data',
    txnDate: inputs.txnDate,
  }
}

/**
 * A period-lock throw, mapped onto the status vocabulary.
 *
 * NOT `period_closed`: `resolvePeriodLock` throws when the stored
 * `ledger.lockedThroughMonth` is unusable, which is a broken setting rather than
 * a closed month - a genuinely closed month is refused later, by
 * `assertPeriodOpen` inside the poster, and lands as `period_closed` from there.
 * Nor `setup_incomplete`, which `types.ts` defines specifically as a draft
 * `accounting.setupState`; overloading it would send the reader to the wrong
 * screen. The message already names the setting to fix.
 */
function classifyLockError(
  error: unknown,
  organizationId: string,
  periodKey: string,
  txnDate: string
): CloseRefusal {
  if (error instanceof AuxxError) {
    return { status: 'error', error: error.message, failureClass: 'configuration', txnDate }
  }
  return { ...unexpected(error, organizationId, periodKey), txnDate }
}

/**
 * Something nobody planned for. Logged - this is the one channel that SHOULD
 * fire - and returned rather than thrown.
 */
function unexpected(error: unknown, organizationId: string, periodKey: string): CloseRefusal {
  logger.error('Month-end close failed unexpectedly', { error, organizationId, periodKey })
  return {
    status: 'error',
    error: error instanceof Error ? error.message : 'Internal error',
    failureClass: 'data',
  }
}

/**
 * Whether all six month-end lanes are unchanged, which is what "nothing moved"
 * means. Written defensively rather than trusting the types: this runs on the
 * catch path, and the builder also throws when a snapshot half is missing
 * entirely, at which point the typed shape is a claim rather than a fact. A
 * non-number on either side answers `false`, so a malformed month is reported as
 * the error it is instead of being quietly skipped.
 */
function everyLaneUnchanged(inputs: MonthEndInventoryInputs): boolean {
  const prior = inputs?.prior
  const current = inputs?.current
  if (!prior?.balances || !prior?.activityTotals) return false
  if (!current?.balances || !current?.activityTotals) return false

  const lanes: Array<[unknown, unknown]> = [
    [prior.balances.inventory_raw_materials, current.balances.inventory_raw_materials],
    [prior.balances.inventory_wip, current.balances.inventory_wip],
    [prior.balances.inventory_finished_goods, current.balances.inventory_finished_goods],
    [prior.activityTotals.absorbedLabor, current.activityTotals.absorbedLabor],
    [prior.activityTotals.absorbedOverhead, current.activityTotals.absorbedOverhead],
    [prior.activityTotals.inventoryAdjustments, current.activityTotals.inventoryAdjustments],
  ]

  return lanes.every(
    ([before, after]) => typeof before === 'number' && typeof after === 'number' && before === after
  )
}

// ── Refusals, in the two shapes the callers need ───────────────────────────

/**
 * A refusal as an {@link EntryPreview}.
 *
 * There is no entry, so there are no lines, no document number and no total -
 * and inventing any of them would put a number on a screen that no post would
 * ever write. Empty is the honest projection; `blockedBy` carries the whole
 * answer, which is what the screen renders.
 */
function refusalPreview(periodKey: string, refusal: CloseRefusal): EntryPreview {
  return {
    postingType: POSTING_TYPE,
    periodKey,
    txnDate: refusal.txnDate ?? '',
    docNumber: '',
    lines: [],
    totalMinor: 0,
    blockedBy: { status: refusal.status, error: refusal.error },
  }
}

/**
 * A refusal as a {@link PostResult}.
 *
 * No `glPostingId` and no `docNumber`, which is the caller's signal that nothing
 * was written: every refusal here is raised before the claim.
 */
function refusalResult(refusal: CloseRefusal): PostResult {
  return {
    status: refusal.status,
    error: refusal.error,
    ...(refusal.failureClass ? { failureClass: refusal.failureClass } : {}),
  }
}
