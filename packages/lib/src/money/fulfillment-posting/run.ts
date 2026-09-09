// packages/lib/src/money/fulfillment-posting/run.ts

/**
 * Phase 3 of the bulk fulfillment poster: EXECUTE a {@link FulfillmentPostingPlan}.
 *
 * `plans/money/tasks/49-bulk-fulfillment-posting.md` §2.3 item 5, §2.4 and §8.2.
 *
 * `plan.ts` decides what to post with no database, no clock and no settings;
 * this file writes it, one `GlPosting` per group and one stamp per shipment.
 * The split, and the never-throws discipline below, are
 * `builds/backfill-builds.ts` again.
 *
 * ## 🛑 It is NOT atomic, and the summary is what says so
 *
 * A group is `postEntry` followed by N stamps, and those are separate
 * transactions - `postEntry` opens its own and makes a provider call, so
 * holding the claim's index tuple across the stamps would hold it across an
 * HTTP round trip. So a group can end up posted-with-unstamped-shipments, which
 * is the one state in this whole feature that a person MUST look at: an
 * unstamped shipment reads as unposted to the netting read, and the next run
 * would recognise its revenue a second time under the next attempt key, where
 * the claim's unique index cannot catch it. That outcome is reported in BOTH
 * `posted` (the ledger truth) and `failed` (the thing that needs a person).
 *
 * ## 🛑 `already_posted` is a SKIP here, never a success
 *
 * It is a success everywhere else in the poster - a converged re-run. Here it
 * means the group's period key was already claimed by a posting this run did
 * not make, so the entry it holds is NOT this group's entry and stamping this
 * group's shipments onto it would attach them to somebody else's numbers. The
 * attempt counter exists to make it unreachable (§8.2); reaching it anyway
 * means the count and the claim disagree, and the honest answer is to write
 * nothing and say so.
 *
 * ## 🛑 Never throws
 *
 * Three layers, matching `backfill-builds.ts`: every STAMP inside its own `try`
 * so one order's lock contention does not lose the rest of the group; every
 * GROUP inside its own `try` so one refused build does not lose the run; and the
 * whole body inside one final `try` so a caller (a worker job, the `auto` lane)
 * always gets a summary.
 *
 * No permission checks. The router asserts `ledgerPost`
 * (`docs/lib-module-guide.md` §6).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, like, ne, or } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { buildFulfillmentBatchEntry } from '../../postings/build-fulfillment-batch-entry'
import { resolvePeriodLock } from '../../postings/period-lock'
import { postEntry } from '../../postings/post-entry'
import {
  FINALIZED_SETUP_STATE,
  OPENING_BASELINE_SETTING_KEYS,
} from '../../postings/setup-readiness'
import { getOrganizationSetting } from '../../settings/settings-service'
import { stampFulfillment } from '../orders/fulfill'
import { guard } from './guard'
import { planFulfillmentPosting } from './plan'
import { readFulfillmentPostingSettings, readUnpostedShipments } from './reads'
import type {
  FulfillmentPostingGroup,
  FulfillmentPostingPlan,
  FulfillmentPostingRequest,
  FulfillmentPostingRunSummary,
} from './types'

const logger = createScopedLogger('money-fulfillment-posting')

/**
 * The `postEntry` statuses that mean the LEDGER took the entry.
 *
 * The same set `money/orders/fulfill.ts` uses, minus `already_posted`: see the
 * file header. `not_connected` and `disabled` stay in, because an org with no
 * accounting provider connected is a first-class case (decision P1) - the entry
 * is built, balanced and persisted identically and simply never pushed, so its
 * shipments are posted and must be stamped.
 */
const POSTED_STATUSES = new Set<string>(['posted', 'healed', 'not_connected', 'disabled'])

/** One progress line per this many groups, so a long run is observable. */
const PROGRESS_EVERY = 10

/**
 * What the dialog renders: the plan, plus the reason the run would refuse to
 * execute it.
 *
 * ⚠️ The plan is computed and returned EVEN WHEN `refusal` is set. A person
 * whose book time zone is unset still needs to see that 531 shipments are
 * waiting, or they cannot tell whether fixing one settings row is worth doing.
 * A non-null `refusal` means {@link runFulfillmentPosting} will write nothing,
 * and the caller must not offer the confirm button.
 */
export interface FulfillmentPostingPreview {
  plan: FulfillmentPostingPlan
  refusal: string | null
}

/**
 * What the run WOULD post, without writing anything.
 *
 * Runs the same read and the same pure plan `runFulfillmentPosting` runs, so
 * what the dialog shows is what the run would freeze.
 */
export async function previewFulfillmentPosting(
  db: Database,
  request: FulfillmentPostingRequest
): Promise<Result<FulfillmentPostingPreview, Error>> {
  const { organizationId, range, grouping } = request

  return guard(
    async () => {
      const prepared = await prepare(db, request)
      return { plan: prepared.plan, refusal: prepared.refusal }
    },
    'Failed to preview a bulk fulfillment posting',
    { organizationId, from: range.from, to: range.to, grouping }
  )
}

/**
 * Post one entry per group and stamp every shipment it covers.
 *
 * @returns a summary, never a throw. A caller that ignores it is behaving
 *   correctly; the `auto` lane does exactly that.
 */
export async function runFulfillmentPosting(
  db: Database,
  request: FulfillmentPostingRequest
): Promise<FulfillmentPostingRunSummary> {
  const { organizationId, range, grouping } = request
  const summary: FulfillmentPostingRunSummary = {
    posted: [],
    skipped: [],
    failed: [],
    exclusions: [],
  }

  try {
    const prepared = await prepare(db, request)
    if (prepared.refusal) {
      // 🛑 A run-level refusal has no group to hang on, and the summary type is
      // the seam five lanes are built against, so it lands in `skipped` under
      // the range's own key. `skipped` is "declined without error", which is
      // exactly what an unset book time zone is. Nothing is written, and the
      // exclusions are deliberately left empty: nothing was decided about an
      // individual shipment.
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

    // Nobody pressed a button on the `auto` lane, and attributing the write to
    // whoever last synced would put a person's name on a decision the system
    // made. Same call `ensureStandardCost` makes. Resolved AFTER the refusal
    // gate, because a refused run writes nothing and needs no writer.
    const actorUserId =
      request.actorUserId ?? (await getOrgCache().get(organizationId, 'systemUser'))

    let written = 0
    for (const group of plan.groups) {
      // 🛑 One refused group must not lose the rest of the run.
      try {
        await executeGroup(db, request, { group, ledgerCurrency, actorUserId }, summary)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        summary.failed.push({ groupKey: group.groupKey, reason })
        logger.error('A fulfillment posting group failed; continuing with the run', {
          organizationId,
          groupKey: group.groupKey,
          reason,
        })
      }
      written += 1
      if (written % PROGRESS_EVERY === 0) {
        logger.info('Posting fulfillments', { organizationId, written, of: plan.groups.length })
      }
    }

    logger.info('Posted fulfillments', {
      organizationId,
      grouping,
      from: range.from,
      to: range.to,
      groups: plan.groups.length,
      posted: summary.posted.length,
      skipped: summary.skipped.length,
      failed: summary.failed.length,
      excluded: summary.exclusions.length,
    })
    return summary
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    summary.failed.push({ groupKey: `${range.from}..${range.to}`, reason })
    logger.error('A bulk fulfillment posting run failed before it wrote anything', {
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
  plan: FulfillmentPostingPlan
  ledgerCurrency: string
  /**
   * Why the run will write nothing, or null when it may proceed.
   *
   * ⚠️ The plan is computed EITHER WAY. A person whose book time zone is unset
   * still needs to see that 531 shipments are waiting, or they cannot tell
   * whether fixing one settings row is worth doing. `runFulfillmentPosting`
   * stops on a non-null value; the preview renders both.
   */
  refusal: string | null
}

/**
 * Read the settings, read the shipments, plan them, and say whether the books
 * can take an entry at all.
 *
 * One function so the preview and the run cannot disagree about either half.
 */
async function prepare(db: Database, request: FulfillmentPostingRequest): Promise<PreparedRun> {
  const { organizationId, range, grouping } = request

  const [settingsResult, setupState] = await Promise.all([
    readFulfillmentPostingSettings(db, organizationId),
    getOrganizationSetting({
      organizationId,
      key: OPENING_BASELINE_SETTING_KEYS.setupState,
    }),
  ])
  if (settingsResult.isErr()) throw settingsResult.error
  const settings = settingsResult.value

  const refusal = resolveRefusal(setupState, settings.timeZone)

  const shipmentsResult = await readUnpostedShipments(db, { organizationId, range })
  if (shipmentsResult.isErr()) throw shipmentsResult.error

  const plan = planFulfillmentPosting({
    shipments: shipmentsResult.value,
    grouping,
    cutoffPeriod: settings.cutoffPeriod,
    lockedThroughMonth: settings.lockedThroughMonth,
    ledgerCurrency: settings.ledgerCurrency,
    // 🛑 `'UTC'` only reaches the plan on a run that is ALREADY refused for the
    // missing zone, and the plan does not read it: `shippedAt` is a calendar
    // date in the book zone already, so grouping is string arithmetic. See
    // `plan.ts`'s header.
    timeZone: settings.timeZone ?? 'UTC',
  })

  return { plan, ledgerCurrency: settings.ledgerCurrency, refusal }
}

/**
 * Why a run would write nothing, or null when the books can take an entry.
 *
 * The two refusals are the two states where posting would be a guess rather
 * than a record:
 *
 * - **`accounting.setupState` is not `finalized`.** The same gate
 *   `readOpeningBaseline` applies and `close-month.ts` classifies as
 *   `setup_incomplete`: an organization with no opening baseline has no books
 *   for these entries to join.
 * - **No `accounting.bookTimeZone`.** 44 lane 4's rule. Every entry is dated to
 *   a shipping day and lands in the month that day falls in, so a zone-less run
 *   dates revenue into the wrong month invisibly and uncorrectably once that
 *   month is locked.
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
      'entry this run makes is dated to a shipping day and lands in the month that day falls ' +
      'in, so cutting those days in the wrong zone puts revenue in the wrong month, where it ' +
      'balances and is invisible. Set the book time zone and run again.'
    )
  }
  return null
}

/** Build, post and stamp one group. Throws only what the group layer records. */
async function executeGroup(
  db: Database,
  request: FulfillmentPostingRequest,
  context: { group: FulfillmentPostingGroup; ledgerCurrency: string; actorUserId: string },
  summary: FulfillmentPostingRunSummary
): Promise<void> {
  const { organizationId } = request
  const { group, ledgerCurrency, actorUserId } = context

  // 🛑 The attempt is counted BEFORE the build, off the ledger itself. A day
  // key claims the day once, and a late order backfilled into an already-posted
  // day needs the next attempt (§8.2). A reversed run leaves its reversal
  // standing at the same key, which is why the count includes it - so the day
  // that was reversed comes back as attempt N+1 rather than colliding with the
  // reversed original's tuple and converging to `already_posted`.
  const attempt = await countLiveGroupPostings(db, organizationId, group.groupKey)
  const built = buildFulfillmentBatchEntry({
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
    memo: request.memo ?? `Fulfillments shipped ${group.groupKey}`,
  })

  if (post.status === 'already_posted' || !POSTED_STATUSES.has(post.status)) {
    summary.skipped.push({
      groupKey: group.groupKey,
      status: post.status,
      reason:
        post.status === 'already_posted'
          ? `Period key ${built.periodKey} is already claimed by ${post.docNumber ?? 'another entry'}. ` +
            'Nothing was posted and no shipment was stamped - stamping them onto an entry this run ' +
            'did not make would attach them to numbers this run did not compute.'
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
    shipments: group.shipments.length,
  })

  const unstamped: string[] = []
  for (const shipment of group.shipments) {
    // 🛑 One order's lock contention must not lose the rest of the group's
    // stamps: every shipment left unstamped is a shipment the next run would
    // post a SECOND time.
    try {
      await stampFulfillment(db, {
        organizationId,
        actorUserId,
        orderId: shipment.orderId,
        sequence: shipment.sequence,
        patch: {
          glPostingId,
          docNumber: post.docNumber ?? null,
          // The amounts the BATCH builder computed, not whatever the log was
          // carrying. `subtotalMinor` goes back too, because it is what the
          // next shipment of this order allocates its tax against.
          totalMinor: shipment.amounts.totalMinor,
          subtotalMinor: shipment.amounts.subtotalMinor,
        },
      })
    } catch (error) {
      unstamped.push(`${shipment.orderNumber || shipment.orderId} shipment ${shipment.sequence}`)
      logger.error('A posted shipment could not be stamped', {
        organizationId,
        groupKey: group.groupKey,
        orderId: shipment.orderId,
        sequence: shipment.sequence,
        glPostingId,
        error,
      })
    }
  }

  if (unstamped.length > 0) {
    // ⚠️ In `posted` AND in `failed`. The entry is in the books, so `posted` is
    // the truth about the ledger; `failed` is the only channel that says a
    // person has to act, and this is the one outcome in the feature that
    // genuinely needs one - an unstamped shipment reads as unposted and would
    // be recognised again by the next run.
    summary.failed.push({
      groupKey: group.groupKey,
      reason:
        `${post.docNumber ?? glPostingId} posted, but ${unstamped.length} shipment(s) could not ` +
        `be stamped with it: ${unstamped.join(', ')}. They will be offered again by the next ` +
        'preview and must NOT be posted a second time - stamp them by hand or reverse the entry.',
    })
  }
}

/**
 * How many LIVE `fulfillment` postings already claim this group's key - the
 * `attempt` `fulfillmentBatchPeriodKey` appends.
 *
 * Counted off `GlPosting` rather than off a source line, because a batch
 * entry's clearing, revenue, tax and shipping legs summarise under
 * `fulfillment_batch` and only a terms order leaves an `order`-sourced line
 * (§2.5) - so a source-line count would read zero for a day of card orders and
 * re-claim the same key forever.
 *
 * `status <> 'reversed'` is what makes a reversed run come back cleanly: the
 * reversed ORIGINAL stops counting, its reversal (an ordinary `posted` entry at
 * the same key) keeps counting, so the next attempt is one higher and the run
 * cannot collide with the tuple the original still occupies.
 *
 * The `LIKE` matches the key plus exactly one appended attempt character, which
 * is the shape `writeOffPeriodKey` established: `buildDocNumber` strips hyphens
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
        eq(schema.GlPosting.postingType, 'fulfillment'),
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
