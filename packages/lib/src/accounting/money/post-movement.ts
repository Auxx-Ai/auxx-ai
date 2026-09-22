// packages/lib/src/accounting/money/post-movement.ts

/**
 * The frame every money poster shares: load the movement, resolve where its cash
 * sits, let the caller build the lines, post.
 *
 * What differs per poster is the LINES — a recognition split, one A/R credit, a
 * memo control account, A/P — and that is the accounting. Everything around them
 * (the live-posting check, the enabled/finalized/cutoff gates, the movement load
 * and its three refusals, the endpoint, the three link rows, the period lock and
 * the ledger's answer) had forked into four copies with two result shapes, which
 * is the whole argument for this file (task 71 §10).
 */

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { AuxxError, UnprocessableEntityError } from '../../errors'
import { readOrganizationSettings } from '../../settings/read'
import { buildEntry } from '../ledger/builders/entry'
import { type MovementPostingType, movementPeriodKey } from '../ledger/builders/movement-key'
import { resolvePeriodLock } from '../ledger/periods/period-lock'
import { periodKeyForDate } from '../ledger/periods/periods'
import { didLedgerAccept } from '../ledger/post/ledger-accepted'
import { postEntry } from '../ledger/post/post-entry'
import { findLiveSubjectPosting } from '../ledger/reads/list-postings'
import { isAccountingEnabled } from '../ledger/setup/accounting-enabled'
import { FINALIZED_SETUP_STATE } from '../ledger/setup/setup-readiness'
import type { GlPostingLineInput, GlPostingSourceInput, RoleSourceScope } from '../ledger/types'
import {
  refusalFromError,
  refusalFromPost,
  type WorkItemRefusal,
  withWorkItemCode,
} from '../work-items/refusal'
import { deleteWorkItem, upsertWorkItem } from '../work-items/write'
import { type CashEndpoint, cashEndpointSourceOf, resolveCashEndpoint } from './cash-endpoint'
import { assertPostableMovement, type MovementRow, readMovement } from './reads'

const logger = createScopedLogger('post-movement')

const workKey = (moneyTransactionId: string) => ({
  sourceKind: MOVEMENT_SOURCE_TYPE,
  sourceId: moneyTransactionId,
  stage: 'post' as const,
})

/** Park the refusal on `db`: the prepare transaction it came from rolled back. */
async function parkMovement(
  db: Database,
  organizationId: string,
  moneyTransactionId: string,
  refusal: WorkItemRefusal
): Promise<void> {
  await upsertWorkItem(db, organizationId, { ...workKey(moneyTransactionId), ...refusal })
}

async function clearMovement(
  db: Database,
  organizationId: string,
  moneyTransactionId: string
): Promise<void> {
  await deleteWorkItem(db, organizationId, workKey(moneyTransactionId))
}

/** Every money line's `sourceType`, and the `sourceKind` of the subject link. */
export const MOVEMENT_SOURCE_TYPE = 'money_transaction'

export type MovementPostingResult =
  | { status: 'accepted'; glPostingId: string }
  | { status: 'blocked'; reason: string }
  | { status: 'skipped'; reason: string }

export type { MovementRow } from './reads'

/** What every line of a movement's entry carries before its account and amount. */
export interface MovementLineBase {
  sourceType: string
  sourceId: string
  counterpartyType?: 'customer' | 'vendor'
  counterpartyId?: string
}

export interface LoadedMovement {
  money: MovementRow
  /** `YYYY-MM-DD` in the book zone. */
  effectiveDate: string
  bookTimeZone: string
  base: MovementLineBase
  /**
   * Stamp the rail the money moved through, once, inside the posting transaction.
   * The channel doors learn it here rather than at ingest (task 71 §3).
   */
  stampGateway: (paymentGatewayId: string) => Promise<void>
  /** The movement's own handle says gift card: its endpoint is the liability. Before {@link endpoint}. */
  markGiftCard: () => void
  /** Where the money sits. Resolved once, after any {@link stampGateway}. */
  endpoint: () => Promise<CashEndpoint>
}

export interface PreparedMovement {
  lines: GlPostingLineInput[]
  /** The document the movement settles — the invoice, order, quote or bill. */
  parent?: { sourceKind: string; sourceId: string }
  /** Overrides the movement's own party as the counterparty link. */
  counterparty?: { sourceKind: string; sourceId: string }
  storeId?: string | null
}

/** The posting type each purpose writes. */
const MOVEMENT_POSTING_TYPE: Record<MovementRow['purpose'], MovementPostingType> = {
  customer_receipt: 'payment',
  customer_refund: 'refund',
  vendor_payment: 'vendor_payment',
  vendor_refund: 'vendor_refund',
}

export interface PostMovementInput {
  organizationId: string
  moneyTransactionId: string
  purpose: MovementRow['purpose']
  /** 'Invoice receipt', 'Customer refund', 'Vendor payment'… for memos and refusals. */
  label: string
  actorUserId?: string
  prepare: (tx: Transaction, loaded: LoadedMovement) => Promise<PreparedMovement>
}

async function loadMovement(
  tx: Transaction,
  input: PostMovementInput,
  zone: string
): Promise<{ money: MovementRow; effectiveDate: string }> {
  const money = assertPostableMovement(
    await readMovement(tx, input.organizationId, input.moneyTransactionId, {
      purpose: input.purpose,
    }),
    input.label
  )
  const effectiveDate =
    money.datePrecision === 'date'
      ? money.occurredOn!
      : periodKeyForDate(money.occurredAt!, 'day', zone)
  return { money, effectiveDate }
}

function defaultCounterparty(money: MovementRow): { sourceKind: string; sourceId: string } | null {
  if (!money.partyInstanceId) return null
  const vendorSide = money.purpose === 'vendor_payment' || money.purpose === 'vendor_refund'
  return { sourceKind: vendorSide ? 'company' : 'contact', sourceId: money.partyInstanceId }
}

/**
 * Post one money movement's entry.
 *
 * **Never throws an `AuxxError`.** Every refusal comes back `blocked`, because the
 * money has already moved and the caller records that either way.
 */
export async function postMovementEntry(
  db: Database,
  input: PostMovementInput
): Promise<MovementPostingResult> {
  const live = await findLiveSubjectPosting(db, {
    organizationId: input.organizationId,
    sourceKind: MOVEMENT_SOURCE_TYPE,
    sourceId: input.moneyTransactionId,
  })
  // A failed read of the posting index says nothing about the movement, so it is
  // the one blocked answer that does not mark it.
  if (live.isErr()) return { status: 'blocked', reason: live.error.message }
  if (live.value) {
    await clearMovement(db, input.organizationId, input.moneyTransactionId)
    return { status: 'accepted', glPostingId: live.value.id }
  }

  if (!(await isAccountingEnabled(db, input.organizationId)))
    return { status: 'skipped', reason: 'Accounting is not enabled' }

  let built: {
    entry: ReturnType<typeof buildEntry>
    sources: GlPostingSourceInput[]
    storeId: string | null
    railId: string | null
  }
  try {
    const settings = await readOrganizationSettings(input.organizationId, [
      'accounting.setupState',
      'accounting.bookTimeZone',
      'accounting.cutoffPeriod',
    ] as const)
    if (settings['accounting.setupState'] !== FINALIZED_SETUP_STATE)
      throw new UnprocessableEntityError(
        `Finalize accounting setup before posting ${input.label.toLowerCase()}s`,
        withWorkItemCode('SETUP_INCOMPLETE')
      )
    const zone = settings['accounting.bookTimeZone']
    if (!zone)
      throw new UnprocessableEntityError(
        'Book time zone is not configured',
        withWorkItemCode('SETUP_INCOMPLETE')
      )

    built = await db.transaction(async (tx) => {
      const { money, effectiveDate } = await loadMovement(tx, input, zone)
      let endpoint: CashEndpoint | null = null
      let giftCard = false
      const counterparty = defaultCounterparty(money)
      const loaded: LoadedMovement = {
        money,
        effectiveDate,
        bookTimeZone: zone,
        base: {
          sourceType: MOVEMENT_SOURCE_TYPE,
          sourceId: money.id,
          ...(counterparty
            ? {
                counterpartyType: (counterparty.sourceKind === 'company' ? 'vendor' : 'customer') as
                  | 'customer'
                  | 'vendor',
                counterpartyId: counterparty.sourceId,
              }
            : {}),
        },
        stampGateway: async (paymentGatewayId: string) => {
          if (money.paymentGatewayId) return
          await tx
            .update(schema.MoneyTransaction)
            .set({ paymentGatewayId })
            .where(
              and(
                eq(schema.MoneyTransaction.organizationId, input.organizationId),
                eq(schema.MoneyTransaction.id, money.id),
                isNull(schema.MoneyTransaction.paymentGatewayId)
              )
            )
          money.paymentGatewayId = paymentGatewayId
        },
        markGiftCard: () => {
          giftCard = true
        },
        endpoint: async () => {
          endpoint ??= await resolveCashEndpoint(
            tx,
            input.organizationId,
            cashEndpointSourceOf(money, giftCard),
            input.label
          )
          return endpoint
        },
      }

      const prepared = await input.prepare(tx, loaded)
      const resolved = await loaded.endpoint()
      const postingType = MOVEMENT_POSTING_TYPE[input.purpose]
      const entry = buildEntry({
        postingType,
        // Both key on the MOVEMENT, never on the book date: two payments settle
        // on one day routinely, and a date would be one number for both.
        periodKey: movementPeriodKey(postingType, money.id),
        txnDate: effectiveDate,
        lines: prepared.lines,
      })
      const cutoff = settings['accounting.cutoffPeriod']
      if (cutoff && entry.txnDate.slice(0, 7) <= cutoff)
        throw new UnprocessableEntityError(
          `${input.label} is before the accounting opening cutoff ${cutoff}`,
          withWorkItemCode('BEFORE_CUTOFF')
        )

      const link = prepared.counterparty ?? counterparty
      const sources: GlPostingSourceInput[] = [
        { sourceKind: MOVEMENT_SOURCE_TYPE, sourceId: money.id, linkRole: 'subject' },
        ...(prepared.parent
          ? [
              {
                sourceKind: prepared.parent.sourceKind,
                sourceId: prepared.parent.sourceId,
                linkRole: 'parent' as const,
              },
            ]
          : []),
        ...(link
          ? [
              {
                sourceKind: link.sourceKind,
                sourceId: link.sourceId,
                linkRole: 'counterparty' as const,
              },
            ]
          : []),
      ]
      return { entry, sources, storeId: prepared.storeId ?? null, railId: resolved.railId }
    })
  } catch (error) {
    if (!(error instanceof AuxxError)) throw error
    logger.warn('A money movement could not be prepared', {
      organizationId: input.organizationId,
      moneyTransactionId: input.moneyTransactionId,
      label: input.label,
      error: error.message,
    })
    await parkMovement(db, input.organizationId, input.moneyTransactionId, refusalFromError(error))
    return { status: 'blocked', reason: error.message }
  }

  const scope: RoleSourceScope = {}
  if (built.storeId) scope.store = built.storeId
  if (built.railId) scope.rail = built.railId

  const lock = await resolvePeriodLock(input.organizationId)
  const post = await postEntry(db, {
    organizationId: input.organizationId,
    entry: built.entry,
    actorUserId: input.actorUserId,
    lock,
    // The movement id is already the `subject` row; this memo is the Outbox's title.
    memo: input.label,
    sources: built.sources,
    ...(Object.keys(scope).length ? { scope } : {}),
    storeId: built.storeId,
    railId: built.railId,
  })
  if (!didLedgerAccept(post) || !post.glPostingId) {
    const reason = post.error ?? `The ledger answered ${post.status}`
    await parkMovement(
      db,
      input.organizationId,
      input.moneyTransactionId,
      refusalFromPost(post, {
        railId: built.railId,
        periodKey: built.entry.txnDate.slice(0, 7),
      })
    )
    return { status: 'blocked', reason }
  }
  await clearMovement(db, input.organizationId, input.moneyTransactionId)
  return { status: 'accepted', glPostingId: post.glPostingId }
}
