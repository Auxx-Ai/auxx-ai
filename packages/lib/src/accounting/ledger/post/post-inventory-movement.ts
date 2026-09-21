// packages/lib/src/accounting/ledger/post/post-inventory-movement.ts
//
// The one door every inventory document posts through.
//
// Seven writers - a shipment, a goods receipt, a purchase-order receipt, an
// adjustment, a build, a salvage, the opening run - each write `stock_movement`
// rows inside their own transaction and then post ONE entry against them here,
// on that same transaction. Without a single door each writer would grow its
// own opinion about the subject link, the member set and the export hand-off,
// and the claim is only a claim if every writer spells it the same way.
//
// 🛑 The entry commits WITH the movements. A document whose rows landed and
// whose entry did not is the state the close's `inventory_unposted` blocker
// exists to catch, and it should be unreachable rather than merely detectable.
// The provider push is the one thing that stays outside: see `postEntryInTx`.

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  buildInventoryMovementEntry,
  type InventoryDocumentKind,
  type InventoryMovementLine,
  type ReliefCogsSplit,
} from '../builders/inventory-movement'
import { resolvePeriodLock } from '../periods/period-lock'
import { listPostingsForSource } from '../reads/list-postings'
import { readPostingLineSourceIds } from '../reads/read-posting'
import { isAccountingEnabled } from '../setup/accounting-enabled'
import type { GlPostingSourceInput, PostResult } from '../types'
import { insertSourceLinksInTx } from './insert-posting'
import { exportPostedEntry, type InTxPostResult, postEntryInTx } from './post-entry'
import { reverseEntry } from './reverse-entry'

const logger = createScopedLogger('postings:inventory-movement')

/** What a document is, to the ledger: the row its entry claims against. */
export interface InventoryDocumentSubject {
  sourceKind: string
  sourceId: string
  /**
   * Which pass over that source this is. A fulfillment already carries a
   * `fulfillment` posting as its subject, so its inventory entry claims
   * `'inventory'` beside it rather than contending for the same row.
   */
  occurrence?: string
}

export interface PostInventoryMovementInput {
  organizationId: string
  kind: InventoryDocumentKind
  subject: InventoryDocumentSubject
  /** The order or the purchase order, when the document has one. */
  parent?: { sourceKind: string; sourceId: string } | null
  /** `YYYY-MM-DD`. The document's own accounting date. */
  txnDate: string
  movements: readonly InventoryMovementLine[]
  /** A build's absorbed labour and overhead. See the builder. */
  absorbed?: { laborMinor: number; overheadMinor: number }
  /** A relief's labour and overhead share. See the builder. */
  cogsSplit?: ReliefCogsSplit
  actorUserId?: string
  memo?: string
}

/** `YYYY-MM-DD` from a movement's `occurredAt`, which is the document's book date. */
export function inventoryTxnDate(occurredAt: Date): string {
  return occurredAt.toISOString().slice(0, 10)
}

/**
 * Post one document's inventory entry on the caller's transaction.
 *
 * `null` when there is nothing to post - accounting is off for the org, or the
 * document moved no money (the builder's own answer). Neither is a refusal and
 * neither is logged as one.
 *
 * **Throws** what `postEntryInTx` throws, so the caller's transaction rolls back
 * with it. A business REFUSAL - a locked period, an unmapped role - comes back
 * as a `PostResult` status instead, and the caller keeps its movements.
 */
export async function postInventoryMovementInTx(
  tx: Transaction,
  input: PostInventoryMovementInput
): Promise<InTxPostResult | null> {
  const { organizationId, kind, subject, parent, txnDate, movements, actorUserId, memo } = input

  if (movements.length === 0) return null
  if (!(await isAccountingEnabled(tx, organizationId))) return null

  const built = buildInventoryMovementEntry({
    kind,
    documentKind: subject.sourceKind,
    documentId: subject.sourceId,
    txnDate,
    movements,
    absorbed: input.absorbed,
    cogsSplit: input.cogsSplit,
    memo,
  })
  if (!built) return null

  const sources: GlPostingSourceInput[] = [
    {
      sourceKind: subject.sourceKind,
      sourceId: subject.sourceId,
      linkRole: 'subject',
      ...(subject.occurrence ? { occurrence: subject.occurrence } : {}),
    },
    ...(parent
      ? [{ sourceKind: parent.sourceKind, sourceId: parent.sourceId, linkRole: 'parent' as const }]
      : []),
    // Every movement, so the posting opens exactly the rows it booked and a
    // movement finds its entry. This IS the subledger link (TARGET §5).
    ...built.memberMovementIds.map((movementId) => ({
      sourceKind: 'stock_movement',
      sourceId: movementId,
      linkRole: 'member' as const,
    })),
  ]

  const lock = await resolvePeriodLock(organizationId, tx)
  const result = await postEntryInTx(tx, {
    organizationId,
    entry: built.entry,
    lock,
    sources,
    // Never drafted. An inventory entry mirrors rows that already exist; holding
    // it for review would leave the subledger and the ledger apart by design.
    mode: 'post',
    actorUserId,
    memo,
  })
  return (await inventoryKeyCollision(tx, organizationId, subject.sourceId, result)) ?? result
}

/**
 * Turn an `already_posted` into a refusal when the posting holding our key is a
 * DIFFERENT document.
 *
 * 🛑 `inventoryPeriodKey` folds into 36^6, so two documents can mint one key,
 * and `already_posted` is a SUCCESS - without this the loser's movements sit in
 * the subledger with nothing in the ledger and a clean outcome recorded. Every
 * leg carries the document id as its line `sourceId`, so the winner's lines say
 * whose entry it is. An unreadable winner leaves the status alone, exactly as
 * `findRecurringKeyCollision` does.
 */
async function inventoryKeyCollision(
  tx: Transaction,
  organizationId: string,
  documentId: string,
  result: InTxPostResult
): Promise<InTxPostResult | undefined> {
  if (result.status !== 'already_posted' || !result.glPostingId) return undefined

  const sources = await readPostingLineSourceIds(tx, organizationId, {
    glPostingId: result.glPostingId,
    sourceType: 'stock_movement',
  })
  if (sources.isErr() || sources.value.length === 0) return undefined
  if (sources.value.includes(documentId)) return undefined

  logger.error('An inventory period key collided with another document', {
    organizationId,
    documentId,
    glPostingId: result.glPostingId,
    docNumber: result.docNumber,
    heldBy: sources.value.join(', '),
  })
  return {
    status: 'error',
    failureClass: 'data',
    retryable: false,
    error:
      `This document minted the document number ${result.docNumber ?? '(unknown)'}, which is ` +
      `already held by a different inventory document (${sources.value.join(', ')}). That is a ` +
      'period-key hash collision, not a re-post: nothing was written for this document.',
  }
}

/**
 * Hand a freshly posted inventory entry to the export, after the commit.
 *
 * Never throws and never fails the document: a push that did not happen is the
 * export sweep's problem, and the entry is already in our books.
 */
export async function exportInventoryMovement(
  db: Database,
  post: InTxPostResult | null
): Promise<PostResult | null> {
  if (!post) return null
  const { pendingExport, ...written } = post
  if (!pendingExport) return written
  return exportPostedEntry(db, pendingExport)
}

/**
 * Reverse the live inventory entry a document claimed, freeing its claim.
 *
 * `null` when the document never posted or its entry was already reversed -
 * undoing an unposted document has nothing to back out. Found through
 * `GlPostingSource`, never a stamp field on the record.
 */
export async function reverseInventoryMovementPosting(
  db: Database,
  input: {
    organizationId: string
    subject: InventoryDocumentSubject
    actorUserId?: string
    memo?: string
  }
): Promise<PostResult | null> {
  const { organizationId, subject, actorUserId, memo } = input
  const found = await listPostingsForSource(db, {
    organizationId,
    sourceKind: subject.sourceKind,
    sourceId: subject.sourceId,
  })
  if (found.isErr()) throw found.error

  const occurrence = subject.occurrence ?? 'original'
  const live = found.value.find(
    (posting) =>
      posting.linkRole === 'subject' &&
      posting.occurrence === occurrence &&
      posting.postingType === 'inventory_movement' &&
      posting.status !== 'reversed'
  )
  if (!live) return null

  const lock = await resolvePeriodLock(organizationId)
  const result = await reverseEntry(db, {
    organizationId,
    glPostingId: live.id,
    actorUserId,
    lock,
    memo,
  })
  logger.info('Reversed an inventory entry', {
    organizationId,
    sourceKind: subject.sourceKind,
    sourceId: subject.sourceId,
    status: result.status,
  })
  return result
}

/**
 * The entry a MOVEMENT belongs to, reversed - the door a single-movement
 * correction takes when it does not know which document wrote the row.
 *
 * `null` when the movement is in no live entry. A movement that belongs to a
 * multi-movement document reverses that whole document's entry, which is the
 * honest answer: the entry was of the document, and half an entry is not a
 * thing the ledger can hold.
 */
export async function reversePostingForMovement(
  db: Database,
  input: { organizationId: string; movementId: string; actorUserId?: string; memo?: string }
): Promise<PostResult | null> {
  const { organizationId, movementId, actorUserId, memo } = input
  const found = await listPostingsForSource(db, {
    organizationId,
    sourceKind: 'stock_movement',
    sourceId: movementId,
  })
  if (found.isErr()) throw found.error

  const live = found.value.find(
    (posting) => posting.postingType === 'inventory_movement' && posting.status !== 'reversed'
  )
  if (!live) return null

  const lock = await resolvePeriodLock(organizationId)
  return reverseEntry(db, { organizationId, glPostingId: live.id, actorUserId, lock, memo })
}

/**
 * Add `member` links for the movements a REVERSAL booked.
 *
 * A reversal is built from the original's frozen lines, so it knows nothing
 * about the negating rows the caller wrote alongside it. Without this the new
 * movements would sit in no entry and the close's `inventory_unposted` blocker
 * would report work that is already done.
 *
 * Idempotent by nothing, so it is called once, immediately after the reversal.
 */
export async function linkMovementsToPosting(
  db: Database | Transaction,
  input: { organizationId: string; glPostingId: string; movementIds: readonly string[] }
): Promise<void> {
  const { organizationId, glPostingId, movementIds } = input
  if (movementIds.length === 0) return
  await insertSourceLinksInTx(db, {
    organizationId,
    glPostingId,
    sources: movementIds.map((movementId) => ({
      sourceKind: 'stock_movement',
      sourceId: movementId,
      linkRole: 'member' as const,
      occurrence: 'reversal',
    })),
    mode: 'post',
  })
}
