// packages/lib/src/accounting/money/blocked-movements.ts

/**
 * The money model's sweep and the one dispatcher that knows which poster a movement
 * belongs to (75-D1). A refused movement is parked as an `AccountingWorkItem` by
 * `postMovementEntry`; this file offers it again and reads the movement drawer.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import { type Database, schema } from '@auxx/database'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { NotFoundError } from '../../errors'
import { readOrganizationSettings } from '../../settings/read'
import { listWorkItemsForSource, type WorkItemRow } from '../work-items/reads'
import { noWorkItem, runWorkItemSweep, type SweepCounts } from '../work-items/sweep'
import { postCustomerReceiptAccounting } from './customer-money/accounting'
import { postCustomerRefundAccounting } from './customer-money/refund-accounting'
import { acceptInvoiceReceiptAccounting } from './invoice-payments/receipt-accounting'
import type { MovementPostingResult, MovementRow } from './post-movement'
import { listLiveApplications, listMovementApplications, readMovement } from './reads'
import { acceptVendorPaymentAccounting } from './vendor-payments/payment-accounting'
import { postVendorRefundAccounting } from './vendor-payments/refund-accounting'

export type MovementPurpose = MovementRow['purpose']

export interface MovementCandidateWindow {
  /** `accounting.cutoffPeriod` (`YYYY-MM`). Movements on or before it are refused forever. */
  cutoffPeriod: string | null
  /** `accounting.bookTimeZone`, the zone an instant's book month is cut in. */
  bookTimeZone: string
}

/**
 * Movements nobody has tried: no live subject posting and no work item at `post`.
 *
 * A reversal deletes the `subject` row, so a reversed movement is re-offered without
 * a state machine of its own. Refused ones come back through their work item's
 * `nextAttemptAt`, never through here, so they cannot crowd out a fresh one.
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
    noWorkItem(organizationId, {
      stage: 'post',
      sourceKind: 'money_transaction',
      sourceId: schema.MoneyTransaction.id,
    }),
    // Parked upstream on its evidence; the ingest sweep owns it until the acceptance clears.
    sql`NOT EXISTS (SELECT 1 FROM ${schema.FinancialSourceAcceptance} parked
      WHERE parked."organizationId" = ${organizationId}
      AND parked."moneyTransactionId" = ${schema.MoneyTransaction.id}
      AND parked."state" = 'blocked')`,
  ]
  if (window?.cutoffPeriod)
    // The book month the poster would compute, in SQL: a date-precision movement
    // already IS its day; an instant is cut in the book zone.
    conditions.push(
      sql`to_char(COALESCE(${schema.MoneyTransaction.occurredOn}, (${schema.MoneyTransaction.occurredAt} AT TIME ZONE ${window.bookTimeZone})::date), 'YYYY-MM') > ${window.cutoffPeriod}`
    )

  const rows = await db
    .select({ id: schema.MoneyTransaction.id, purpose: schema.MoneyTransaction.purpose })
    .from(schema.MoneyTransaction)
    .where(and(...conditions))
    .orderBy(asc(schema.MoneyTransaction.createdAt), asc(schema.MoneyTransaction.id))
    .limit(limit)
  return rows as Array<{ id: string; purpose: MovementPurpose }>
}

/**
 * Which poster a movement belongs to, decided from its evidence rather than from
 * a provider key: a `customer_receipt` applied to an invoice is the invoice door;
 * every other receipt, applied to an order or to nothing yet, posts on its own
 * facts (91 §8.6, guide §8.3).
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
  return postCustomerReceiptAccounting
}

export interface PostBlockedMovementInput {
  organizationId: string
  moneyTransactionId: string
  actorUserId?: string
}

/**
 * Post one movement through whichever poster its evidence names.
 *
 * Throws only when the movement does not exist; every
 * accounting refusal comes back `blocked` with its work item written by
 * `postMovementEntry`, and acceptance deletes it.
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

/** Bounded recovery, every purpose: never-tried movements first, then due work items. */
export async function sweepMovementAccounting(
  db: Database,
  input: { organizationId: string; limit?: number; timeBudgetMs?: number }
): Promise<SweepCounts> {
  // One settings read for the whole run rather than one refusal per movement.
  const settings = await readOrganizationSettings(input.organizationId, [
    'accounting.bookTimeZone',
    'accounting.cutoffPeriod',
  ] as const)
  return runWorkItemSweep(db, {
    organizationId: input.organizationId,
    stage: 'post',
    sourceKind: 'money_transaction',
    limit: input.limit ?? 100,
    timeBudgetMs: input.timeBudgetMs,
    listFresh: async (limit) =>
      (
        await listMovementAccountingCandidates(db, input.organizationId, limit, {
          cutoffPeriod: settings['accounting.cutoffPeriod'],
          bookTimeZone: settings['accounting.bookTimeZone'] ?? 'UTC',
        })
      ).map((row) => row.id),
    handle: (moneyTransactionId) =>
      postBlockedMovement(db, { organizationId: input.organizationId, moneyTransactionId }),
  })
}

/** A record a movement points at, with which role it plays for the movement. */
export interface MovementLinkedRecord {
  role: 'cash_account' | 'order' | 'invoice' | 'vendor_bill' | 'quote'
  instanceId: string
  definitionId: string | null
  displayName: string | null
}

/** One movement in full, parked or posted - the movement drawer's read (83 §2.3). */
export interface MovementDetail {
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
  /** Its own `post` row and its acceptances' `evidence` rows; empty once nothing is parked. */
  workItems: WorkItemRow[]
  /** The cash account, then every document the money was applied to. */
  links: MovementLinkedRecord[]
}

/** One movement with the records it points at, or `null` if it does not exist. */
export async function readMovementDetail(
  db: Database,
  organizationId: string,
  moneyTransactionId: string
): Promise<MovementDetail | null> {
  const [row] = await db
    .select({
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
    })
    .from(schema.MoneyTransaction)
    .leftJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.organizationId, schema.MoneyTransaction.organizationId),
        eq(schema.EntityInstance.id, schema.MoneyTransaction.partyInstanceId)
      )
    )
    .where(
      and(
        eq(schema.MoneyTransaction.organizationId, organizationId),
        eq(schema.MoneyTransaction.id, moneyTransactionId)
      )
    )
    .limit(1)
  if (!row) return null

  const [applications, workItems] = await Promise.all([
    listLiveApplications(db, organizationId, moneyTransactionId),
    listWorkItemsForSource(db, organizationId, {
      sourceKind: 'money_transaction',
      sourceId: moneyTransactionId,
    }),
  ])

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
    ...row,
    amountMinor: Number(row.amountMinor),
    workItems: workItems.isOk() ? workItems.value : [],
    links: refs.map((ref) => ({
      ...ref,
      definitionId: byId.get(ref.instanceId)?.definitionId ?? null,
      displayName: byId.get(ref.instanceId)?.displayName ?? null,
    })),
  }
}
