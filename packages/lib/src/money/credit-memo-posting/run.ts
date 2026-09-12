// packages/lib/src/money/credit-memo-posting/run.ts

/**
 * Phase 3 of the bulk credit memo poster: EXECUTE a {@link CreditMemoPostingPlan}.
 *
 * `plans/accounting/tasks/25-batch-posting-and-credit-memos.md` §3, §4.4 and §8.
 *
 * `plan.ts` decides what to post with no database, no clock and no settings;
 * this file writes it, one `GlPosting` per group and one stamp per memo. The
 * split, and the never-throws discipline below, are `fulfillment-posting/run.ts`
 * again - and deliberately so, because the two doors are one dialog and one
 * worker away from being the same feature (§5).
 *
 * ## 🛑 It ISSUES the drafts, and issue-then-post is not atomic either
 *
 * Channel memos are ingested as `draft`, so with `issueDrafts` every `draft`
 * member of a group is flipped through `issueCreditMemo(..., { post: false })`
 * BEFORE the group's entry is built. `post: false` is what makes that a batch
 * rather than 1,061 single-memo entries, and it is why no stamp is written
 * there: the memo is stamped below with the GROUP's posting id.
 *
 * A memo issued here that the group then fails to post is an ordinary unposted
 * memo - the next netting read offers it again, the next run posts it, and
 * nothing is double-booked, because a stamp is the only thing that says posted.
 * That is the acceptable half of the non-atomicity; the unstamped half below is
 * the one that needs a person.
 *
 * ## 🛑 It is NOT atomic, and the summary is what says so
 *
 * A group is `postEntry` followed by N stamps, and those are separate
 * transactions - `postEntry` opens its own and makes a provider call, so holding
 * the claim's index tuple across the stamps would hold it across an HTTP round
 * trip. So a group can end up posted-with-unstamped-memos, which is the one
 * state in this whole feature that a person MUST look at: an unstamped memo
 * reads as unposted to the netting read, and the next run would reverse its
 * revenue a second time under the next attempt key, where the claim's unique
 * index cannot catch it. That outcome is reported in BOTH `posted` (the ledger
 * truth) and `failed` (the thing that needs a person). §4.4 says it in those
 * words; do not quietly "fix" it.
 *
 * ## 🛑 `already_posted` is a SKIP here, never a success
 *
 * It is a success everywhere else in the poster - a converged re-run. Here it
 * means the group's period key was already claimed by a posting this run did not
 * make, so the entry it holds is NOT this group's entry and stamping this
 * group's memos onto it would attach them to somebody else's numbers. The
 * attempt counter exists to make it unreachable; reaching it anyway means the
 * count and the claim disagree, and the honest answer is to write nothing and
 * say so.
 *
 * ## 🛑 Never throws
 *
 * Four layers: every ISSUE and every STAMP inside its own `try` so one memo's
 * refusal or lock contention does not lose the rest of the group; every GROUP
 * inside its own `try` so one refused build does not lose the run; and the whole
 * body inside one final `try` so a caller always gets a summary.
 *
 * No permission checks. The router asserts `ledgerPost`
 * (`docs/lib-module-guide.md` §6).
 */

import { type Database, database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, like, ne, or } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getEntityDefIdResolver, getOrgCache } from '../../cache'
import { FieldValueService } from '../../field-values/field-value-service'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import { buildCreditMemoBatchEntry } from '../../postings/build-credit-memo-batch-entry'
import { CREDIT_MEMO_POSTING_TYPE } from '../../postings/build-credit-memo-entry'
import { isExpectedPostOutcome } from '../../postings/ledger-accepted'
import { resolvePeriodLock } from '../../postings/period-lock'
import { postEntry } from '../../postings/post-entry'
import {
  FINALIZED_SETUP_STATE,
  OPENING_BASELINE_SETTING_KEYS,
} from '../../postings/setup-readiness'
import { getOrganizationSetting } from '../../settings/settings-service'
import { issueCreditMemo } from '../credit-memos/writes'
import { countUnpostedShipments } from '../fulfillment-posting/reads'
import { guard } from './guard'
import { collapseCreditMemoGroup, planCreditMemoPosting } from './plan'
import {
  readCreditMemoPostingSettings,
  readCreditMemoSettlementAccounts,
  readUnpostedCreditMemos,
  type UnpostedCreditMemoRange,
} from './reads'
import type {
  CreditMemoPostingGroup,
  CreditMemoPostingPlan,
  CreditMemoPostingRequest,
  CreditMemoPostingRunSummary,
} from './types'
import { CREDIT_MEMO_GL_POSTING_ATTRIBUTE } from './types'

const logger = createScopedLogger('money-credit-memo-posting')

/** One progress line per this many groups, so a long run is observable. */
const PROGRESS_EVERY = 10

/**
 * How many months §8's warning will count before it gives up counting.
 *
 * The warning runs the fulfillment netting read once per month, so an unbounded
 * range would make a preview pay for every month the org has ever traded. Twelve
 * covers the whole January backlog this feature was built for, and the warning
 * is a banner: an undercount reads as "no ordering problem found", never as a
 * wrong number in the books.
 */
const MAX_WARNING_MONTHS = 12

/**
 * What the dialog renders: the plan, plus the reason the run would refuse to
 * execute it.
 *
 * ⚠️ The plan is computed and returned EVEN WHEN `refusal` is set. A person
 * whose book time zone is unset still needs to see that 1,061 memos are waiting,
 * or they cannot tell whether fixing one settings row is worth doing. A non-null
 * `refusal` means {@link runCreditMemoPosting} will write nothing, and the
 * caller must not offer the confirm button.
 */
export interface CreditMemoPostingPreview {
  plan: CreditMemoPostingPlan
  refusal: string | null
}

/**
 * What a preview is asked for: no actor, because nothing is written.
 *
 * ⚠️ `issueDrafts` belongs here even though a preview issues nothing: it decides
 * whether a `draft` is a PLANNED member or a `not-issued` exclusion, so a
 * preview that guessed it would show a different plan from the run it precedes.
 * `footer.drafts` is how the dialog says how many memos the button will issue.
 */
export type CreditMemoPostingPreviewInput = Pick<
  CreditMemoPostingRequest,
  'organizationId' | 'range' | 'grouping' | 'issueDrafts'
>

/**
 * What the run WOULD post, without writing anything.
 *
 * Runs the same reads and the same pure plan {@link runCreditMemoPosting} runs,
 * so what the dialog shows is what the run would freeze.
 *
 * 🛑 Writes NOTHING, `issueDrafts` or not. It plans the drafts as members and
 * counts them in `footer.drafts`; flipping them is {@link runCreditMemoPosting}'s
 * alone.
 */
export async function previewCreditMemoPosting(
  db: Database,
  request: CreditMemoPostingPreviewInput
): Promise<Result<CreditMemoPostingPreview, Error>> {
  const { organizationId, range, grouping } = request

  return guard(
    async () => {
      const prepared = await prepare(db, request)
      return { plan: prepared.plan, refusal: prepared.refusal }
    },
    'Failed to preview a bulk credit memo posting',
    { organizationId, from: range.from, to: range.to, grouping }
  )
}

/**
 * Post one entry per group and stamp every memo it covers.
 *
 * @returns a summary, never a throw. A caller that ignores it is behaving
 *   correctly.
 */
export async function runCreditMemoPosting(
  db: Database,
  request: CreditMemoPostingRequest
): Promise<CreditMemoPostingRunSummary> {
  const { organizationId, range, grouping } = request
  const summary: CreditMemoPostingRunSummary = {
    posted: [],
    skipped: [],
    failed: [],
    issued: { count: 0, failed: [] },
    exclusions: [],
  }

  try {
    // 🛑 Checked ONCE per org, before the settings read, the netting read and the
    // plan - none of which this run has any use for when the org has never
    // turned accounting on (task 17 §3). A first-class silent case: nothing is
    // read, nothing is built, nothing is logged, and the summary comes back
    // exactly as empty as "nothing to post".
    if (!(await isAccountingEnabled(db, organizationId))) {
      return summary
    }

    const prepared = await prepare(db, request)
    if (prepared.refusal) {
      // 🛑 A run-level refusal has no group to hang on, so it lands in `skipped`
      // under the range's own key. `skipped` is "declined without error", which
      // is exactly what an unset book time zone is. Nothing is written, and the
      // exclusions are deliberately left empty: nothing was decided about an
      // individual memo.
      summary.skipped.push({
        groupKey: `${range.from}..${range.to}`,
        status: 'refused',
        reason: prepared.refusal,
      })
      return summary
    }

    const { plan, ledgerCurrency } = prepared
    summary.exclusions = plan.exclusions
    if (plan.groups.length === 0) return summary

    // Nobody pressed a button on an automated lane, and attributing the write to
    // whoever last synced would put a person's name on a decision the system
    // made. Resolved AFTER the refusal gate, because a refused run writes
    // nothing and needs no writer.
    const actorUserId =
      request.actorUserId ?? (await getOrgCache().get(organizationId, 'systemUser'))
    const stamp = await creditMemoStampWriter(db, organizationId, actorUserId)

    let written = 0
    for (const group of plan.groups) {
      // 🛑 One refused group must not lose the rest of the run.
      try {
        await executeGroup(db, request, { group, ledgerCurrency, actorUserId, stamp }, summary)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        summary.failed.push({ groupKey: group.groupKey, reason })
        logger.error('A credit memo posting group failed; continuing with the run', {
          organizationId,
          groupKey: group.groupKey,
          reason,
        })
      }
      written += 1
      if (written % PROGRESS_EVERY === 0) {
        logger.info('Posting credit memos', { organizationId, written, of: plan.groups.length })
      }
    }

    logger.info('Posted credit memos', {
      organizationId,
      grouping,
      from: range.from,
      to: range.to,
      groups: plan.groups.length,
      posted: summary.posted.length,
      skipped: summary.skipped.length,
      failed: summary.failed.length,
      issued: summary.issued.count,
      unissuable: summary.issued.failed.length,
      excluded: summary.exclusions.length,
    })
    return summary
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    summary.failed.push({ groupKey: `${range.from}..${range.to}`, reason })
    logger.error('A bulk credit memo posting run failed before it wrote anything', {
      organizationId,
      from: range.from,
      to: range.to,
      reason,
    })
    return summary
  }
}

/** Everything a run resolves once, before any entry is built. */
interface PreparedRun {
  plan: CreditMemoPostingPlan
  ledgerCurrency: string
  /**
   * Why the run will write nothing, or null when it may proceed.
   *
   * ⚠️ The plan is computed EITHER WAY - the preview renders both.
   */
  refusal: string | null
}

/**
 * Read the settings, read the memos, resolve their settlement accounts, plan
 * them, and say whether the books can take an entry at all.
 *
 * One function so the preview and the run cannot disagree about either half.
 */
async function prepare(db: Database, request: CreditMemoPostingPreviewInput): Promise<PreparedRun> {
  const { organizationId, range, grouping } = request

  const [settingsResult, setupState] = await Promise.all([
    readCreditMemoPostingSettings(db, organizationId),
    getOrganizationSetting({
      organizationId,
      key: OPENING_BASELINE_SETTING_KEYS.setupState,
    }),
  ])
  if (settingsResult.isErr()) throw settingsResult.error
  const settings = settingsResult.value

  const refusal = resolveRefusal(setupState, settings.timeZone)

  const memosResult = await readUnpostedCreditMemos(db, { organizationId, range })
  if (memosResult.isErr()) throw memosResult.error
  const memos = memosResult.value

  const [accountsResult, unpostedShipments] = await Promise.all([
    readCreditMemoSettlementAccounts(db, { organizationId, memos }),
    countUnpostedShipmentsInRange(db, organizationId, range),
  ])
  if (accountsResult.isErr()) throw accountsResult.error

  const plan = planCreditMemoPosting({
    memos,
    settlementAccounts: accountsResult.value,
    unpostedShipments,
    grouping,
    issueDrafts: request.issueDrafts,
    cutoffPeriod: settings.cutoffPeriod,
    lockedThroughMonth: settings.lockedThroughMonth,
    ledgerCurrency: settings.ledgerCurrency,
    // 🛑 `'UTC'` only reaches the plan on a run that is ALREADY refused for the
    // missing zone, and the plan does not read it: `issuedAt` is a calendar date
    // in the book zone already, so grouping is string arithmetic. See
    // `plan.ts`'s header.
    timeZone: settings.timeZone ?? 'UTC',
  })

  return { plan, ledgerCurrency: settings.ledgerCurrency, refusal }
}

/**
 * §8's ordering warning: how many shipments in the months this range covers
 * still owe the ledger a posting.
 *
 * 🛑 A WARNING, never a refusal, and never a throw. Posting contra-revenue
 * before the revenue books it against revenue that is not in the books yet;
 * both entries balance, so nothing notices, and it nets out within the month.
 * Refusing would be stronger than the problem - but a person about to post
 * January's returns needs to be told that January's sales have not posted.
 *
 * ⚠️ Scoped to the months the RANGE covers rather than to all of history, which
 * is the narrowing the brief's "at or before the range end" allows and the cost
 * demands: `countUnpostedShipments` runs the whole fulfillment netting read for
 * one month, and the ordering trap is about the period being posted. Capped at
 * {@link MAX_WARNING_MONTHS}.
 */
async function countUnpostedShipmentsInRange(
  db: Database,
  organizationId: string,
  range: UnpostedCreditMemoRange
): Promise<number> {
  try {
    let total = 0
    for (const month of monthsCovered(range)) {
      const count = await countUnpostedShipments(db, { organizationId, month })
      if (count.isOk()) total += count.value
    }
    return total
  } catch (error) {
    logger.error('The unposted shipment warning could not be counted; continuing without it', {
      organizationId,
      from: range.from,
      to: range.to,
      error,
    })
    return 0
  }
}

/**
 * The `YYYY-MM` months a half-open day range touches, in order.
 *
 * The end is EXCLUSIVE, so a range ending `2026-02-01` covers January alone -
 * the same off-by-one the dialog's own end-day control exists to hide (§6.1).
 */
function monthsCovered(range: UnpostedCreditMemoRange): string[] {
  const months: string[] = []
  const start = Date.parse(`${range.from}T00:00:00.000Z`)
  const end = Date.parse(`${range.to}T00:00:00.000Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return months

  // The last day the half-open range includes.
  const last = new Date(end - 86_400_000)
  const cursor = new Date(start)
  cursor.setUTCDate(1)
  const lastMonth = monthKey(last)
  while (months.length < MAX_WARNING_MONTHS) {
    const key = monthKey(cursor)
    months.push(key)
    if (key >= lastMonth) break
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return months
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Why a run would write nothing, or null when the books can take an entry.
 *
 * The two refusals are the two states where posting would be a guess rather than
 * a record, and they are the fulfillment poster's two, for the same reasons:
 *
 * - **`accounting.setupState` is not `finalized`.** An organization with no
 *   opening baseline has no books for these entries to join.
 * - **No `accounting.bookTimeZone`.** Every entry is dated to an issue day and
 *   lands in the month that day falls in, so a zone-less run dates a return into
 *   the wrong month invisibly and uncorrectably once that month is locked.
 *
 * Setup is checked FIRST: an org that has not finished the wizard has not set
 * the time zone either, and naming the zone would send them to the wrong screen.
 */
function resolveRefusal(setupState: unknown, timeZone: string | null): string | null {
  if (setupState !== FINALIZED_SETUP_STATE) {
    return (
      'Accounting setup for this organization is not finalized ' +
      `(${OPENING_BASELINE_SETTING_KEYS.setupState} is ${describe(setupState)}, expected ` +
      `"${FINALIZED_SETUP_STATE}"). There is no opening baseline for these entries to join, ` +
      'so nothing is posted. Finish the accounting setup wizard and run again.'
    )
  }
  if (!timeZone) {
    return (
      `The book time zone (${OPENING_BASELINE_SETTING_KEYS.bookTimeZone}) is not set. Every ` +
      'entry this run makes is dated to the day a memo was issued and lands in the month that ' +
      'day falls in, so cutting those days in the wrong zone puts a return in the wrong month, ' +
      'where it balances and is invisible. Set the book time zone and run again.'
    )
  }
  return null
}

/** Write one memo's `credit_memo_gl_posting` stamp. */
type StampWriter = (creditMemoId: string, glPostingId: string) => Promise<void>

/**
 * The stamp writer, built once per run.
 *
 * 🛑 A SCALAR `FieldValue` write, not a JSON cell: no lock, no envelope, no
 * read-modify-write. §4.1 chose a declared TEXT field over the fulfillment
 * poster's `glPostingId`-inside-a-JSON-array precisely so this is an ordinary
 * field write and so the netting read is an indexable join.
 *
 * `credit_memo_gl_posting` carries no lifecycle guard (only `credit_memo_status`
 * does, `resources/hooks/credit-memo-hooks.ts`), so unlike `statusWriter` in
 * `credit-memos/writes.ts` this needs no `bypassFieldGuards` - and
 * `FieldValueService` clears the system pre-hook chain structurally anyway.
 */
async function creditMemoStampWriter(
  db: Database,
  organizationId: string,
  userId: string
): Promise<StampWriter> {
  const resolveDefId = await getEntityDefIdResolver(organizationId)
  // `undefined` for the pooled handle, so the service opens its own session -
  // the same test `statusWriter` makes, and what keeps a stamp out of any
  // transaction the caller happens to hold.
  const service = new FieldValueService(organizationId, userId, db === database ? undefined : db)
  return async (creditMemoId, glPostingId) => {
    await service.setValuesForEntity({
      recordId: toRecordId(resolveDefId('credit_memo'), creditMemoId),
      values: [{ fieldId: CREDIT_MEMO_GL_POSTING_ATTRIBUTE, value: glPostingId }],
    })
  }
}

/**
 * Flip every `draft` member of a group to `issued`, WITHOUT posting a thing.
 *
 * 🛑 `{ post: false }` is the whole point (brief 25 §7, `credit-memos/writes.ts`).
 * Issuing through the ordinary door with the ledger attached would mint one
 * single-memo entry per memo - 1,061 of them on DemoOrg1's backlog - which is
 * exactly what the batch poster exists to prevent. No stamp is written there
 * either; {@link executeGroup} stamps the survivors with the GROUP's posting id.
 *
 * 🛑 **One memo's refusal must not lose the group**, so every issue sits in its
 * own `try` - the same discipline the stamps below have. A memo that refuses is
 * DROPPED from the group rather than left in it: a member that is still a draft
 * would otherwise be summarised into an entry that says it was credited, and
 * then stamped as posted. The group is re-collapsed through
 * {@link collapseCreditMemoGroup} so its totals, its A/R line count and its
 * transaction date describe the members that are actually left.
 *
 * ⚠️ **Issue-then-post is NOT atomic, and that is acceptable.** A memo issued
 * here whose group then fails to post is an ordinary unposted memo: it carries
 * no stamp, so the next netting read offers it again and the next run posts it.
 * Nothing is double-booked, because the stamp is the only thing that says
 * posted. Compare the stamp failure below, which is the outcome that does need a
 * person.
 *
 * @returns the group as it should now be built, or the same object untouched.
 */
async function issueGroupDrafts(
  db: Database,
  request: CreditMemoPostingRequest,
  context: { group: CreditMemoPostingGroup; actorUserId: string },
  summary: CreditMemoPostingRunSummary
): Promise<CreditMemoPostingGroup> {
  const { organizationId } = request
  const { group, actorUserId } = context
  if (!request.issueDrafts) return group

  const dropped = new Set<string>()
  for (const memo of group.memos) {
    if (memo.status !== 'draft') continue
    try {
      await issueCreditMemo(
        db,
        {
          organizationId,
          userId: actorUserId,
          creditMemoInstanceId: memo.creditMemoId,
          // 🛑 The memo's OWN date, pinned rather than defaulted. It is the date
          // the plan grouped on, so a January backlog issued in September stays
          // in January instead of being dated by the clock.
          issuedAt: memo.issuedAt,
        },
        { post: false }
      )
      summary.issued.count += 1
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      dropped.add(memo.creditMemoId)
      summary.issued.failed.push({
        creditMemoId: memo.creditMemoId,
        number: memo.number,
        reason,
      })
      logger.error('A draft credit memo could not be issued; dropping it from its group', {
        organizationId,
        groupKey: group.groupKey,
        creditMemoId: memo.creditMemoId,
        reason,
      })
    }
  }

  if (dropped.size === 0) return group
  return collapseCreditMemoGroup(
    group.groupKey,
    group.memos.filter((memo) => !dropped.has(memo.creditMemoId))
  )
}

/** Issue, build, post and stamp one group. Throws only what the group layer records. */
async function executeGroup(
  db: Database,
  request: CreditMemoPostingRequest,
  context: {
    group: CreditMemoPostingGroup
    ledgerCurrency: string
    actorUserId: string
    stamp: StampWriter
  },
  summary: CreditMemoPostingRunSummary
): Promise<void> {
  const { organizationId } = request
  const { ledgerCurrency, actorUserId, stamp } = context

  // 🛑 BEFORE the attempt count and the build, so the entry is dimensioned on
  // the members that actually issued.
  const group = await issueGroupDrafts(db, request, context, summary)
  if (group.memos.length === 0) {
    // Every member refused. Nothing was posted and nothing needs to be: the
    // refusals are already in `summary.issued.failed`, which is where a person
    // looks, and a group with no members is a skip rather than a failure.
    summary.skipped.push({
      groupKey: group.groupKey,
      status: 'no_members',
      reason:
        `Every credit memo in ${group.groupKey} failed to issue, so there was nothing to post. ` +
        'See the issue failures for the reason on each one.',
    })
    return
  }

  // 🛑 The attempt is counted BEFORE the build, off the ledger itself. A month
  // key claims the month once, and a memo issued late into an already-posted
  // January needs the next attempt. A reversed run leaves its reversal standing
  // at the same key, which is why the count includes it - so the period that was
  // reversed comes back as attempt N+1 rather than colliding with the reversed
  // original's tuple and converging to `already_posted`.
  const attempt = await countLiveGroupPostings(db, organizationId, group.groupKey)
  const built = buildCreditMemoBatchEntry({
    group,
    ledgerCurrency,
    attempt,
    ...(request.memo ? { memo: request.memo } : {}),
  })

  const lock = await resolvePeriodLock(organizationId)
  const post = await postEntry(db, {
    organizationId,
    entry: built.entry,
    actorUserId,
    lock,
    memo: request.memo ?? `Credit memos issued ${group.groupKey}`,
  })

  // 🛑 `already_posted` is excluded DELIBERATELY and is the one place this
  // differs from a plain acceptance check: the claim was made by some other run,
  // so this run must not stamp memos onto numbers it did not compute.
  if (post.status === 'already_posted' || !isExpectedPostOutcome(post)) {
    summary.skipped.push({
      groupKey: group.groupKey,
      status: post.status,
      reason:
        post.status === 'already_posted'
          ? `Period key ${built.periodKey} is already claimed by ${post.docNumber ?? 'another entry'}. ` +
            'Nothing was posted and no memo was stamped - stamping them onto an entry this run did ' +
            'not make would attach them to numbers this run did not compute.'
          : (post.error ?? `The ledger declined the entry (${post.status})`),
    })
    return
  }

  const glPostingId = post.glPostingId
  if (!glPostingId) {
    // Unreachable by contract - every accepted status carries the claimed row -
    // and recorded rather than asserted, because a run that threw here would
    // lose the groups after it.
    summary.skipped.push({
      groupKey: group.groupKey,
      status: post.status,
      reason: 'The ledger accepted the entry but named no posting, so nothing could be stamped',
    })
    return
  }

  summary.posted.push({
    groupKey: group.groupKey,
    postingId: glPostingId,
    docNumber: post.docNumber ?? '',
    memos: group.memos.length,
  })

  const unstamped: string[] = []
  for (const memo of group.memos) {
    // 🛑 One memo's lock contention must not lose the rest of the group's
    // stamps: every memo left unstamped is a memo the next run would post a
    // SECOND time.
    try {
      await stamp(memo.creditMemoId, glPostingId)
    } catch (error) {
      unstamped.push(memo.number || memo.creditMemoId)
      logger.error('A posted credit memo could not be stamped', {
        organizationId,
        groupKey: group.groupKey,
        creditMemoId: memo.creditMemoId,
        glPostingId,
        error,
      })
    }
  }

  if (unstamped.length > 0) {
    // ⚠️ In `posted` AND in `failed` (§4.4). The entry is in the books, so
    // `posted` is the truth about the ledger; `failed` is the only channel that
    // says a person has to act, and this is the one outcome in the feature that
    // genuinely needs one - an unstamped memo reads as unposted and would have
    // its revenue reversed again by the next run.
    summary.failed.push({
      groupKey: group.groupKey,
      reason:
        `${post.docNumber ?? glPostingId} posted, but ${unstamped.length} credit memo(s) could ` +
        `not be stamped with it: ${unstamped.join(', ')}. They will be offered again by the next ` +
        'preview and must NOT be posted a second time - stamp them by hand or reverse the entry.',
    })
  }
}

/**
 * How many LIVE `credit_memo` postings already claim this group's key - the
 * `attempt` `creditMemoBatchPeriodKey` appends.
 *
 * Counted off `GlPosting` rather than off a source line, because a batch entry's
 * contra-revenue, tax and clearing legs summarise under `credit_memo_batch` and
 * only an unsettled memo leaves a `contact`-sourced line (§3.3) - so a
 * source-line count would read zero for a month of fully refunded channel memos
 * and re-claim the same key forever.
 *
 * ⚠️ A single-memo entry shares this `postingType` but keys on the memo NUMBER
 * (`CM-0007`), which no day or month key can collide with, so the two doors do
 * not see each other's claims.
 *
 * `status <> 'reversed'` is what makes a reversed run come back cleanly: the
 * reversed ORIGINAL stops counting, its reversal (an ordinary `posted` entry at
 * the same key) keeps counting, so the next attempt is one higher and the run
 * cannot collide with the tuple the original still occupies. That is the
 * documented correction path for a batched memo (§2.1), so it has to work.
 *
 * The `LIKE` matches the key plus exactly one appended attempt character, which
 * is the shape `creditMemoBatchPeriodKey` mints: `buildDocNumber` strips hyphens
 * and nothing else, so there is no separator to match on.
 */
async function countLiveGroupPostings(
  db: Database,
  organizationId: string,
  groupKey: string
): Promise<number> {
  const rows = await db
    .select({ id: schema.GlPosting.id })
    .from(schema.GlPosting)
    .where(
      and(
        eq(schema.GlPosting.organizationId, organizationId),
        eq(schema.GlPosting.postingType, CREDIT_MEMO_POSTING_TYPE),
        ne(schema.GlPosting.status, 'reversed'),
        or(
          eq(schema.GlPosting.periodKey, groupKey),
          like(schema.GlPosting.periodKey, `${groupKey}_`)
        )
      )
    )
  return rows.length
}

/** A setting value, rendered short enough to put in a refusal. */
function describe(value: unknown): string {
  if (value == null) return 'unset'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'object') return Array.isArray(value) ? 'an array' : 'an object'
  return `${typeof value} ${JSON.stringify(value)}`
}
