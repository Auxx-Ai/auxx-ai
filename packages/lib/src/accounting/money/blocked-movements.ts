// packages/lib/src/accounting/money/blocked-movements.ts

/**
 * The parked work of the money model: every movement the ledger has refused, the
 * queue that offers them again, and the one dispatcher that knows which poster a
 * movement belongs to (75-D1).
 *
 * The candidate query was `customer-money/receipt-accounting.ts`'s, filtered to
 * two purposes and to Shopify-sourced evidence. Neither gate was a safety
 * property - they were the only lane that existed - so a blocked `vendor_payment`
 * was parked forever. The query is verbatim without them; what decides the poster
 * is now the movement's own evidence, below.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import { type Database, schema } from '@auxx/database'
import { and, asc, count, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { NotFoundError, UnprocessableEntityError } from '../../errors'
import { readOrganizationSettings } from '../../settings/read'
import { postCustomerReceiptAccounting } from './customer-money/accounting'
import { postCustomerRefundAccounting } from './customer-money/refund-accounting'
import { acceptInvoiceReceiptAccounting } from './invoice-payments/receipt-accounting'
import type { MovementPostingResult, MovementRow } from './post-movement'
import { listLiveApplications, listMovementApplications, readMovement } from './reads'
import { acceptVendorPaymentAccounting } from './vendor-payments/payment-accounting'
import { postVendorRefundAccounting } from './vendor-payments/refund-accounting'

export type MovementPurpose = MovementRow['purpose']

/** How long a refused movement waits before the sweep offers it again. */
export const POSTING_RETRY_INTERVAL_MS = 60 * 60 * 1000

export interface MovementCandidateWindow {
  /** `accounting.cutoffPeriod` (`YYYY-MM`). Movements on or before it are refused forever. */
  cutoffPeriod: string | null
  /** `accounting.bookTimeZone`, the zone an instant's book month is cut in. */
  bookTimeZone: string
  /** Movements blocked more recently than this are held back. */
  retryBefore: Date
}

/**
 * Every movement with no live subject posting, of any purpose.
 *
 * The claim is the candidate list: a movement that has posted holds a `subject`
 * row on `GlPostingSource`, and a reversal deletes that row, so the same query
 * re-offers a reversed movement without a state machine of its own.
 *
 * 🛑 **No head-of-line blocking.** A thousand receipts on an unmapped handle must
 * not stop a postable one from being reached, so a movement the ledger refused is
 * held back for {@link POSTING_RETRY_INTERVAL_MS} and then queued BEHIND every
 * movement nobody has tried yet. Anything before the opening cutoff is refused
 * forever and is excluded in SQL rather than re-refused every run.
 */
export async function listMovementAccountingCandidates(
  db: Database,
  organizationId: string,
  limit = 100,
  window?: MovementCandidateWindow
): Promise<Array<{ id: string; purpose: MovementPurpose }>> {
  const conditions = [
    eq(schema.MoneyTransaction.organizationId, organizationId),
    sql`NOT EXISTS (SELECT 1 FROM ${schema.GlPostingSource} link
        WHERE link."organizationId" = ${organizationId}
        AND link."sourceKind" = 'money_transaction'
        AND link."sourceId" = ${schema.MoneyTransaction.id}
        AND link."linkRole" = 'subject')`,
    // Waiting on a draft in the Outbox: no claim yet, but nothing to do either.
    sql`NOT EXISTS (SELECT 1 FROM ${schema.GlPostingSource} pending
        JOIN ${schema.GlPosting} draft ON draft."id" = pending."glPostingId"
        WHERE pending."organizationId" = ${organizationId}
        AND pending."sourceKind" = 'money_transaction'
        AND pending."sourceId" = ${schema.MoneyTransaction.id}
        AND pending."linkRole" = 'pending'
        AND draft."status" = 'draft')`,
  ]
  if (window?.cutoffPeriod)
    // The book month the poster would compute, in SQL: a date-precision movement
    // already IS its day; an instant is cut in the book zone.
    conditions.push(
      sql`to_char(COALESCE(${schema.MoneyTransaction.occurredOn}, (${schema.MoneyTransaction.occurredAt} AT TIME ZONE ${window.bookTimeZone})::date), 'YYYY-MM') > ${window.cutoffPeriod}`
    )
  if (window)
    conditions.push(
      sql`(${schema.MoneyTransaction.postingBlockedAt} IS NULL OR ${schema.MoneyTransaction.postingBlockedAt} <= ${window.retryBefore})`,
      // Parked on a record change upstream, so re-reading it hourly can only refuse
      // it again — the ingest sweep excludes the same rows (79 §4.5).
      sql`NOT EXISTS (SELECT 1 FROM ${schema.FinancialSourceAcceptance} parked
        WHERE parked."organizationId" = ${organizationId}
        AND parked."moneyTransactionId" = ${schema.MoneyTransaction.id}
        AND parked."state" = 'blocked'
        AND parked."nextAttemptAt" IS NULL)`
    )

  const rows = await db
    .select({ id: schema.MoneyTransaction.id, purpose: schema.MoneyTransaction.purpose })
    .from(schema.MoneyTransaction)
    .where(and(...conditions))
    .orderBy(
      sql`${schema.MoneyTransaction.postingBlockedAt} ASC NULLS FIRST`,
      asc(schema.MoneyTransaction.createdAt),
      asc(schema.MoneyTransaction.id)
    )
    .limit(limit)
  return rows as Array<{ id: string; purpose: MovementPurpose }>
}

/**
 * Which poster a movement belongs to, decided from its evidence rather than from
 * a provider key: a `customer_receipt` applied to an invoice is the invoice door,
 * one applied to an order is the recognition door, and the two never see each
 * other's movements (guide §8.3).
 */
async function resolvePoster(
  db: Database,
  organizationId: string,
  money: MovementRow
): Promise<(db: Database, input: PostBlockedMovementInput) => Promise<MovementPostingResult>> {
  if (money.purpose === 'vendor_payment') return acceptVendorPaymentAccounting
  if (money.purpose === 'vendor_refund') return postVendorRefundAccounting
  if (money.purpose === 'customer_refund') return postCustomerRefundAccounting

  const applications = await listMovementApplications(db, organizationId, money.id)
  if (applications.some((row) => row.invoiceInstanceId)) return acceptInvoiceReceiptAccounting
  if (applications.some((row) => row.orderInstanceId)) return postCustomerReceiptAccounting
  throw new UnprocessableEntityError(
    'Receipt is applied to neither an invoice nor an order, so there is no entry to post'
  )
}

export interface PostBlockedMovementInput {
  organizationId: string
  moneyTransactionId: string
  actorUserId?: string
}

/**
 * Post one movement through whichever poster its evidence names.
 *
 * Throws only when the movement does not exist or names no document; every
 * accounting refusal comes back `blocked`, and acceptance clears the mark
 * through `markPostingBlock(…, null)` inside `postMovementEntry`.
 */
export async function postBlockedMovement(
  db: Database,
  input: PostBlockedMovementInput
): Promise<MovementPostingResult> {
  const money = await readMovement(db, input.organizationId, input.moneyTransactionId)
  if (!money) throw new NotFoundError('That movement does not exist')
  const post = await resolvePoster(db, input.organizationId, money)
  return post(db, input)
}

/**
 * Bounded recovery: every purpose, one schedule. Replaces the customer-money
 * sweep, which could only ever repair the two purposes it filtered to.
 */
export async function sweepMovementAccounting(
  db: Database,
  input: { organizationId: string; limit?: number; timeBudgetMs?: number }
) {
  const started = Date.now()
  // Hoisted, so the window is one settings read for the whole run rather than one
  // refusal per movement.
  const settings = await readOrganizationSettings(input.organizationId, [
    'accounting.bookTimeZone',
    'accounting.cutoffPeriod',
  ] as const)
  const candidates = await listMovementAccountingCandidates(
    db,
    input.organizationId,
    Math.min(input.limit ?? 100, 500),
    {
      cutoffPeriod: settings['accounting.cutoffPeriod'],
      bookTimeZone: settings['accounting.bookTimeZone'] ?? 'UTC',
      retryBefore: new Date(started - POSTING_RETRY_INTERVAL_MS),
    }
  )
  const counts = { scanned: 0, accepted: 0, drafted: 0, blocked: 0, skipped: 0 }
  for (const candidate of candidates) {
    if (input.timeBudgetMs != null && Date.now() - started >= input.timeBudgetMs) break
    counts.scanned++
    try {
      const result = await postBlockedMovement(db, {
        organizationId: input.organizationId,
        moneyTransactionId: candidate.id,
      })
      counts[result.status]++
    } catch {
      // A movement whose evidence names no document is not postable by anybody;
      // the sweep counts it and moves on rather than ending the page.
      counts.blocked++
    }
  }
  return counts
}

/** One parked movement, as the Outbox's Blocked tab renders it. */
export interface BlockedMovementRow {
  id: string
  purpose: MovementPurpose
  /** Integer minor units. */
  amountMinor: number
  currency: string
  currencyExponent: number
  occurredOn: string | null
  occurredAt: Date | null
  /** The customer or vendor the money moved with, when the movement names one. */
  partyName: string | null
  partyInstanceId: string | null
  partyDefinitionId: string | null
  cashAccountInstanceId: string | null
  reference: string | null
  note: string | null
  method: MovementRow['method']
  /**
   * The blocked ingest acceptance's own words when one stands behind the
   * movement, else `postEntry`'s. Rendered verbatim - never paraphrased.
   */
  reason: string
  blockedAt: Date | null
  /** `account_unmapped` gets the remedy card; everything else is plain text. */
  reasonKind: 'account_unmapped' | 'other'
  /** How many times the ingest has tried; `null` for a movement with no acceptance. */
  acceptanceAttempts: number | null
  /** What the acceptance waits for: a change to its order, or its next attempt time. */
  acceptanceWaitingOn: 'change' | 'time' | null
}

/** A record a movement points at, with which role it plays for the movement. */
export interface MovementLinkedRecord {
  role: 'cash_account' | 'order' | 'invoice' | 'vendor_bill' | 'quote'
  instanceId: string
  definitionId: string | null
  displayName: string | null
}

/** One parked movement in full - the drawer's read. */
export interface BlockedMovementDetail extends BlockedMovementRow {
  /** The cash account, then every document the money was applied to. */
  links: MovementLinkedRecord[]
}

/** One movement in full whether or not it is parked - the movement drawer's read (83 §2.3). */
export interface MovementDetail extends Omit<BlockedMovementRow, 'reason' | 'reasonKind'> {
  /** The refusal, or `null` once the movement posted or was never parked. */
  reason: string | null
  reasonKind: 'account_unmapped' | 'other' | null
  /** The cash account, then every document the money was applied to. */
  links: MovementLinkedRecord[]
}

/**
 * The true refusal: a movement the ingest blocked waits on its acceptance's
 * reason, not on the poster's message about the application it never got (79 §1.3).
 */
const REASON = sql<
  string | null
>`COALESCE(${schema.FinancialSourceAcceptance.reason}, ${schema.MoneyTransaction.postingBlockedReason})`

/**
 * The refusal shape, from its prefix: `resolve-roles.ts` opens every unmapped-role
 * refusal with "Cannot post:" and nothing else does.
 */
const REASON_KIND = sql<
  'account_unmapped' | 'other'
>`CASE WHEN ${REASON} LIKE 'Cannot post:%' THEN 'account_unmapped' ELSE 'other' END`

/** A blocked acceptance with no `nextAttemptAt` is parked until its order changes (79 §4.2). */
const ACCEPTANCE_WAITING_ON = sql<'change' | 'time' | null>`CASE
  WHEN ${schema.FinancialSourceAcceptance.id} IS NULL THEN NULL
  WHEN ${schema.FinancialSourceAcceptance.nextAttemptAt} IS NULL THEN 'change'
  ELSE 'time' END`

/** The movement holds no live `subject` posting: it never posted, or a reversal removed it. */
function noSubjectPosting(organizationId: string) {
  return sql`NOT EXISTS (SELECT 1 FROM ${schema.GlPostingSource} link
      WHERE link."organizationId" = ${organizationId}
      AND link."sourceKind" = 'money_transaction'
      AND link."sourceId" = ${schema.MoneyTransaction.id}
      AND link."linkRole" = 'subject')`
}

/** A movement is parked when it carries a reason and holds no live subject posting. */
function blockedWhere(organizationId: string) {
  return and(
    eq(schema.MoneyTransaction.organizationId, organizationId),
    isNotNull(schema.MoneyTransaction.postingBlockedReason),
    noSubjectPosting(organizationId)
  )
}

/**
 * The row's columns with the party joined - the list and the detail select the same thing.
 *
 * `blocked` restates {@link blockedWhere} per row, because the detail read drops
 * that predicate from its `WHERE` and still has to answer it (83 §2.3).
 */
function selectMovementRows(db: Database, organizationId: string) {
  return db
    .select({
      blocked: sql<boolean>`(${schema.MoneyTransaction.postingBlockedReason} IS NOT NULL AND ${noSubjectPosting(organizationId)})`,
      id: schema.MoneyTransaction.id,
      purpose: schema.MoneyTransaction.purpose,
      amountMinor: schema.MoneyTransaction.amountMinor,
      currency: schema.MoneyTransaction.currency,
      currencyExponent: schema.MoneyTransaction.currencyExponent,
      occurredOn: schema.MoneyTransaction.occurredOn,
      occurredAt: schema.MoneyTransaction.occurredAt,
      partyName: schema.EntityInstance.displayName,
      partyInstanceId: schema.EntityInstance.id,
      partyDefinitionId: schema.EntityInstance.entityDefinitionId,
      cashAccountInstanceId: schema.MoneyTransaction.cashAccountInstanceId,
      reference: schema.MoneyTransaction.reference,
      note: schema.MoneyTransaction.note,
      method: schema.MoneyTransaction.method,
      reason: REASON,
      blockedAt: schema.MoneyTransaction.postingBlockedAt,
      reasonKind: REASON_KIND,
      acceptanceAttempts: schema.FinancialSourceAcceptance.attempts,
      acceptanceWaitingOn: ACCEPTANCE_WAITING_ON,
    })
    .from(schema.MoneyTransaction)
    .leftJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.organizationId, schema.MoneyTransaction.organizationId),
        eq(schema.EntityInstance.id, schema.MoneyTransaction.partyInstanceId)
      )
    )
    .leftJoin(
      schema.FinancialSourceAcceptance,
      and(
        eq(schema.FinancialSourceAcceptance.organizationId, schema.MoneyTransaction.organizationId),
        eq(schema.FinancialSourceAcceptance.moneyTransactionId, schema.MoneyTransaction.id),
        eq(schema.FinancialSourceAcceptance.state, 'blocked')
      )
    )
}

type SelectedMovementRow = Awaited<
  ReturnType<ReturnType<typeof selectMovementRows>['execute']>
>[number]

function toBlockedRow({ blocked: _blocked, ...row }: SelectedMovementRow): BlockedMovementRow {
  return { ...row, amountMinor: Number(row.amountMinor), reason: row.reason ?? '' }
}

/** A posted movement keeps its money columns and loses every refusal column. */
function toMovementRow({ blocked, ...row }: SelectedMovementRow): Omit<MovementDetail, 'links'> {
  return {
    ...row,
    amountMinor: Number(row.amountMinor),
    reason: blocked ? (row.reason ?? '') : null,
    reasonKind: blocked ? row.reasonKind : null,
    blockedAt: blocked ? row.blockedAt : null,
    acceptanceAttempts: blocked ? row.acceptanceAttempts : null,
    acceptanceWaitingOn: blocked ? row.acceptanceWaitingOn : null,
  }
}

/** Newest refusal first, so a role somebody just hit surfaces above a year of backlog. */
export async function listBlockedMovements(
  db: Database,
  organizationId: string,
  options: {
    limit?: number
    offset?: number
    categories?: MovementPurpose[]
    search?: string
    from?: string
    to?: string
  } = {}
): Promise<BlockedMovementRow[]> {
  const settings =
    options.from || options.to
      ? await readOrganizationSettings(organizationId, ['accounting.bookTimeZone'])
      : null
  const zone = settings?.['accounting.bookTimeZone'] ?? 'UTC'
  const day = sql`COALESCE(${schema.MoneyTransaction.occurredOn}, (${schema.MoneyTransaction.occurredAt} AT TIME ZONE ${zone})::date)`
  const rows = await selectMovementRows(db, organizationId)
    .where(
      and(
        blockedWhere(organizationId),
        options.categories?.length
          ? inArray(schema.MoneyTransaction.purpose, options.categories)
          : undefined,
        options.from ? sql`${day} >= ${options.from}::date` : undefined,
        options.to ? sql`${day} <= ${options.to}::date` : undefined,
        options.search
          ? sql`strpos(lower(concat_ws(' ', ${schema.EntityInstance.displayName}, ${schema.MoneyTransaction.reference}, ${schema.MoneyTransaction.note}, ${REASON})), lower(${options.search})) > 0`
          : undefined
      )
    )
    .orderBy(
      sql`${schema.MoneyTransaction.postingBlockedAt} DESC NULLS LAST`,
      asc(schema.MoneyTransaction.id)
    )
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0)
  return rows.map(toBlockedRow)
}

/** One movement with the records it points at, blocked or posted, or `null` if it does not exist. */
async function readMovementWithLinks(
  db: Database,
  organizationId: string,
  moneyTransactionId: string
): Promise<{ row: SelectedMovementRow; links: MovementLinkedRecord[] } | null> {
  const [row] = await selectMovementRows(db, organizationId)
    .where(
      and(
        eq(schema.MoneyTransaction.organizationId, organizationId),
        eq(schema.MoneyTransaction.id, moneyTransactionId)
      )
    )
    .limit(1)
  if (!row) return null

  const applications = await listLiveApplications(db, organizationId, moneyTransactionId)

  const refs: Array<{ role: MovementLinkedRecord['role']; instanceId: string }> = []
  const seen = new Set<string>()
  const push = (role: MovementLinkedRecord['role'], instanceId: string | null) => {
    if (!instanceId || seen.has(instanceId)) return
    seen.add(instanceId)
    refs.push({ role, instanceId })
  }
  push('cash_account', row.cashAccountInstanceId)
  for (const application of applications) {
    push('order', application.orderInstanceId)
    push('invoice', application.invoiceInstanceId)
    push('vendor_bill', application.vendorBillInstanceId)
    push('quote', application.quoteInstanceId)
  }

  const instances =
    refs.length === 0
      ? []
      : await db
          .select({
            id: schema.EntityInstance.id,
            definitionId: schema.EntityInstance.entityDefinitionId,
            displayName: schema.EntityInstance.displayName,
          })
          .from(schema.EntityInstance)
          .where(
            and(
              eq(schema.EntityInstance.organizationId, organizationId),
              inArray(
                schema.EntityInstance.id,
                refs.map((ref) => ref.instanceId)
              )
            )
          )
  const byId = new Map(instances.map((instance) => [instance.id, instance]))

  return {
    row,
    links: refs.map((ref) => ({
      ...ref,
      definitionId: byId.get(ref.instanceId)?.definitionId ?? null,
      displayName: byId.get(ref.instanceId)?.displayName ?? null,
    })),
  }
}

/** One movement with the records it points at, whether or not the ledger refused it. */
export async function readMovementDetail(
  db: Database,
  organizationId: string,
  moneyTransactionId: string
): Promise<MovementDetail | null> {
  const found = await readMovementWithLinks(db, organizationId, moneyTransactionId)
  return found && { ...toMovementRow(found.row), links: found.links }
}

/** One parked movement with the records it points at, or `null` once it has posted or never was parked. */
export async function readBlockedMovement(
  db: Database,
  organizationId: string,
  moneyTransactionId: string
): Promise<BlockedMovementDetail | null> {
  const found = await readMovementWithLinks(db, organizationId, moneyTransactionId)
  if (!found?.row.blocked) return null
  return { ...toBlockedRow(found.row), links: found.links }
}

/** The tab's badge. SQL, because a dev org already holds ~1,100 of these. */
export async function countBlockedMovements(db: Database, organizationId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(schema.MoneyTransaction)
    .where(blockedWhere(organizationId))
  return row?.total ?? 0
}
