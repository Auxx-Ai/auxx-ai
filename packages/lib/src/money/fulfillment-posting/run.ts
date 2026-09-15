// packages/lib/src/money/fulfillment-posting/run.ts

/** Preview and execute fulfillment accounting through immutable source membership. */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { acceptEntryInTx } from '../../postings/accept-entry'
import { withAccountingCommitLock } from '../../postings/accounting-commit-lock'
import { isAccountingEnabled } from '../../postings/accounting-enabled'
import { resolveFulfillmentDeliveryIntentInTx } from '../../postings/book-connections'
import { buildEntry } from '../../postings/build-entry'
import { deliverAccountingPosting, planAccountingDeliveryInTx } from '../../postings/delivery'
import { canonicalAccountingJson } from '../../postings/effect-basis'
import {
  FINALIZED_SETUP_STATE,
  OPENING_BASELINE_SETTING_KEYS,
} from '../../postings/setup-readiness'
import type { GlPostingLineInput } from '../../postings/types'
import { getOrganizationSetting } from '../../settings/settings-service'
import { guard } from './guard'
import { loadGatewayRoutesForPlan, planFulfillmentPosting } from './plan'
import { readFulfillmentPostingSettings, readUnpostedShipments } from './reads'
import type {
  FulfillmentPostingGroup,
  FulfillmentPostingPlan,
  FulfillmentPostingRequest,
  FulfillmentPostingRunSummary,
} from './types'
import { FULFILLMENT_POSTING_SETTING_KEY } from './types'
import {
  captureFulfillmentAccountingWorkInTx,
  discoverFulfillmentAccountingWork,
  prepareFulfillmentEffectMemberInTx,
  revalidateFulfillmentMemberInTx,
} from './work'

const logger = createScopedLogger('money-fulfillment-posting')

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
    // 🛑 Checked ONCE per org, before the settings read, the shipment netting
    // read and the plan - none of which this run has any use for when the org
    // has never turned accounting on (task 17 section 3). A first-class silent
    // case, like an org whose Stripe account is not connected: nothing is
    // read, nothing is built, nothing is logged, and the summary comes back
    // exactly as empty as "nothing to post".
    if (!(await isAccountingEnabled(db, organizationId))) {
      return summary
    }

    if (
      request.actorUserId === null &&
      (await getOrganizationSetting({
        organizationId,
        key: FULFILLMENT_POSTING_SETTING_KEY,
        db,
      })) !== 'auto'
    )
      return summary
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
      db,
    }),
  ])
  if (settingsResult.isErr()) throw settingsResult.error
  const settings = settingsResult.value

  const refusal = resolveRefusal(setupState, settings.timeZone)

  const [shipmentsResult, gatewayRoutes] = await Promise.all([
    readUnpostedShipments(db, { organizationId, range }),
    loadGatewayRoutesForPlan(db, organizationId),
  ])
  if (shipmentsResult.isErr()) throw shipmentsResult.error

  const plan = planFulfillmentPosting({
    shipments: shipmentsResult.value,
    gatewayRoutes,
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

/** Capture survives bookkeeping refusal; acceptance and its delivery intent share one commit. */
async function executeGroup(
  db: Database,
  request: FulfillmentPostingRequest,
  context: { group: FulfillmentPostingGroup; ledgerCurrency: string; actorUserId: string },
  summary: FulfillmentPostingRunSummary
): Promise<void> {
  const result = await acceptFulfillmentWorkGroup(db, {
    organizationId: request.organizationId,
    actorUserId: context.actorUserId,
    fulfillmentIds: context.group.shipments.map((shipment) => shipment.fulfillmentInstanceId),
    groupKey: context.group.groupKey,
    automatic: request.actorUserId === null,
    memo: request.memo,
  })
  if (!result) {
    summary.skipped.push({
      groupKey: context.group.groupKey,
      status: 'already_posted',
      reason: 'The selected fulfillments are already accepted or no longer automatically eligible',
    })
    return
  }
  summary.posted.push({
    groupKey: context.group.groupKey,
    postingId: result.glPostingId,
    docNumber: result.docNumber,
    shipments: result.shipments,
  })
}

/** Shared native/manual/automatic command; rereads and recomputes exact remaining members under lock. */
export async function acceptFulfillmentWorkGroup(
  db: Database,
  input: {
    organizationId: string
    actorUserId: string
    fulfillmentIds: readonly string[]
    groupKey: string
    automatic?: boolean
    memo?: string
  }
): Promise<{ glPostingId: string; docNumber: string; shipments: number } | null> {
  const workIds: string[] = []
  for (const fulfillmentInstanceId of [...new Set(input.fulfillmentIds)]) {
    const work = await db.transaction((tx) =>
      captureFulfillmentAccountingWorkInTx(tx, {
        organizationId: input.organizationId,
        fulfillmentInstanceId,
      })
    )
    workIds.push(work.id)
  }
  if (!workIds.length) return null
  const result = await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, input.organizationId)
    if (
      input.automatic &&
      (await getOrganizationSetting({
        organizationId: input.organizationId,
        key: FULFILLMENT_POSTING_SETTING_KEY,
        db: tx,
      })) !== 'auto'
    )
      return null
    const works = await tx.query.AccountingWork.findMany({
      where: and(
        eq(schema.AccountingWork.organizationId, input.organizationId),
        inArray(schema.AccountingWork.id, workIds)
      ),
    })
    const accepted = await tx.query.AccountingEffect.findMany({
      where: and(
        eq(schema.AccountingEffect.organizationId, input.organizationId),
        inArray(schema.AccountingEffect.workId, workIds)
      ),
    })
    const claimed = new Set(accepted.map((effect) => effect.workId))
    const pending = works.filter(
      (work) =>
        !claimed.has(work.id) &&
        ['pending', 'blocked'].includes(work.state) &&
        work.eligibility !== 'excluded' &&
        (!input.automatic || work.eligibility === 'automatic')
    )
    if (!pending.length) {
      if (accepted.length === 1) {
        const posting = await tx.query.GlPosting.findFirst({
          where: and(
            eq(schema.GlPosting.organizationId, input.organizationId),
            eq(schema.GlPosting.id, accepted[0]!.glPostingId)
          ),
        })
        if (posting)
          return { glPostingId: posting.id, docNumber: posting.docNumber ?? '', shipments: 1 }
      }
      return null
    }
    const setupState = await getOrganizationSetting({
      organizationId: input.organizationId,
      key: OPENING_BASELINE_SETTING_KEYS.setupState,
      db: tx,
    })
    const settings = await readFulfillmentPostingSettings(tx, input.organizationId)
    if (settings.isErr()) throw settings.error
    const refusal = resolveRefusal(setupState, settings.value.timeZone)
    if (refusal) throw new UnprocessableEntityError(refusal)
    const prepared = []
    for (const work of pending) {
      // Configuration or source edits after initial capture select another immutable basis version.
      const refreshed = await captureFulfillmentAccountingWorkInTx(tx, {
        organizationId: input.organizationId,
        fulfillmentInstanceId: work.entityInstanceId,
      })
      if (refreshed.state === 'blocked')
        throw new UnprocessableEntityError(
          refreshed.blockedReason ?? 'Fulfillment accounting is blocked'
        )
      const member = await prepareFulfillmentEffectMemberInTx(tx, input.organizationId, work.id)
      if (
        settings.value.cutoffPeriod &&
        member.shipment.shippedAt.slice(0, 7) <= settings.value.cutoffPeriod
      )
        throw new UnprocessableEntityError('Fulfillment is before the opening cutoff')
      prepared.push(member)
    }
    const lines = new Map<string, GlPostingLineInput>()
    for (const item of prepared)
      for (const line of item.entry.lines) {
        const key = canonicalAccountingJson([
          line.glAccountId ?? null,
          line.accountRole ?? null,
          line.direction,
          line.counterpartyType ?? null,
          line.counterpartyId ?? null,
          line.dimensions ?? {},
        ])
        const previous = lines.get(key)
        if (previous) previous.amount += line.amount
        else lines.set(key, { ...line })
      }
    const txnDate = prepared
      .map((item) => item.entry.txnDate)
      .sort()
      .at(-1)!
    const entry = buildEntry({
      postingType: 'fulfillment',
      periodKey: input.groupKey,
      txnDate,
      lines: [...lines.values()],
    })
    entry.sources = prepared.map((item) => ({
      fulfillmentInstanceId: item.shipment.fulfillmentInstanceId,
      orderId: item.shipment.orderId,
      orderNumber: item.shipment.orderNumber,
      sequence: item.shipment.sequence,
      amounts: item.shipment.amounts,
    }))
    const result = await acceptEntryInTx(
      tx,
      {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        entry,
        members: prepared.map((item) => item.member),
        memo: input.memo,
        deliveryIntent: await resolveFulfillmentDeliveryIntentInTx(
          tx,
          input.organizationId,
          txnDate
        ),
      },
      { revalidateMemberInTx: revalidateFulfillmentMemberInTx }
    )
    if (result.status === 'replan')
      throw new Error('Membership changed while holding the accounting lock')
    const glPostingId = result.glPostingId
    if (!glPostingId) throw new Error('New acceptance must produce exactly one journal')
    const posting = await tx.query.GlPosting.findFirst({
      where: and(
        eq(schema.GlPosting.organizationId, input.organizationId),
        eq(schema.GlPosting.id, glPostingId)
      ),
    })
    if (!posting) throw new Error('Accepted journal is missing')
    await planAccountingDeliveryInTx(tx, { organizationId: input.organizationId, glPostingId })
    return { glPostingId, docNumber: posting.docNumber ?? '', shipments: prepared.length }
  })
  if (result) {
    try {
      await deliverAccountingPosting(db, {
        organizationId: input.organizationId,
        glPostingId: result.glPostingId,
      })
    } catch (error) {
      logger.warn('Accepted fulfillment journal awaits delivery recovery', {
        organizationId: input.organizationId,
        glPostingId: result.glPostingId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return result
}

/** A setting value, rendered short enough to put in a refusal. */
function describe(value: unknown): string {
  if (value == null) return 'unset'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'object') return Array.isArray(value) ? 'an array' : 'an object'
  return `${typeof value} ${JSON.stringify(value)}`
}

/** Recover bounded discovered obligations; queue jobs are only optional wake-ups. */
export async function sweepFulfillmentAccountingWork(
  db: Database,
  input: {
    organizationId: string
    actorUserId?: string
    afterId?: string
    limit?: number
  }
): Promise<{ scanned: number; nextCursor: string | null; accepted: number; blocked: number }> {
  if (!(await isAccountingEnabled(db, input.organizationId)))
    return { scanned: 0, nextCursor: null, accepted: 0, blocked: 0 }
  const discovered = await discoverFulfillmentAccountingWork(db, input)
  const result = {
    scanned: discovered.scanned,
    nextCursor: discovered.nextCursor,
    accepted: 0,
    blocked: 0,
  }
  if (
    !discovered.workIds.length ||
    (await getOrganizationSetting({
      organizationId: input.organizationId,
      key: FULFILLMENT_POSTING_SETTING_KEY,
      db,
    })) !== 'auto'
  )
    return result
  const works = await db.query.AccountingWork.findMany({
    where: and(
      eq(schema.AccountingWork.organizationId, input.organizationId),
      inArray(schema.AccountingWork.id, discovered.workIds)
    ),
  })
  const actorUserId =
    input.actorUserId ?? (await getOrgCache().get(input.organizationId, 'systemUser'))
  const groups = new Map<string, string[]>()
  for (const work of works) {
    if (work.state === 'blocked') {
      result.blocked++
      continue
    }
    if (work.state !== 'pending' || work.eligibility !== 'automatic') continue
    const basis = await db.query.AccountingWorkBasis.findFirst({
      where: and(
        eq(schema.AccountingWorkBasis.organizationId, input.organizationId),
        eq(schema.AccountingWorkBasis.workId, work.id),
        eq(schema.AccountingWorkBasis.version, work.basisVersion)
      ),
    })
    if (!basis?.effectiveDate) {
      result.blocked++
      continue
    }
    const ids = groups.get(basis.effectiveDate) ?? []
    ids.push(work.entityInstanceId)
    groups.set(basis.effectiveDate, ids)
  }
  for (const [groupKey, fulfillmentIds] of groups) {
    try {
      const accepted = await acceptFulfillmentWorkGroup(db, {
        organizationId: input.organizationId,
        actorUserId,
        fulfillmentIds,
        groupKey,
        automatic: true,
      })
      result.accepted += accepted?.shipments ?? 0
    } catch (error) {
      result.blocked += fulfillmentIds.length
      logger.warn('Fulfillment accounting remains pending after recovery', {
        organizationId: input.organizationId,
        groupKey,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return result
}
