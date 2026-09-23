// packages/lib/src/accounting/documents/edit-in-place/save.ts
//
// Close an edit: bring the ledger up to the document's current values, then drop
// the snapshot row (73 D4, generalised over the spec).
//
// One transaction under `withAccountingCommitLock`, so the reversal, the repost
// and the row commit together — a document whose entry was backed out and never
// re-posted is unreachable rather than merely detectable. Every floor and every
// build refusal runs BEFORE the ledger is touched, and a refusal of any kind
// leaves the entry, the values, the row and the stamp exactly as they were.

import { type Database, schema, withAccountingCommitLock } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { getCachedEntityDefId } from '../../../cache'
import {
  deleteEditSnapshot,
  publishRecordEditStamp,
  readEditStamp,
} from '../../../entity-instances/edit-snapshot'
import { BadRequestError, ConflictError } from '../../../errors'
import { resolvePeriodLock } from '../../ledger/periods/period-lock'
import { didLedgerAccept } from '../../ledger/post/ledger-accepted'
import { reverseEntry } from '../../ledger/post/reverse-entry'
import { readPostingHeaders } from '../../ledger/reads/read-posting'
import type { BuiltEntry, GlPostingLineInput } from '../../ledger/types'
import { readDocumentLedgerState, writeDocumentLedgerGeneration } from '../document-ledger-state'
import type { DocumentEditInput } from './open'
import {
  type DocumentEditDoc,
  type DocumentEditRow,
  documentEditRow,
  type PlainDocumentEditRow,
} from './spec'

const logger = createScopedLogger('accounting:document-edit')

export interface SaveDocumentEditResult {
  /**
   * `unchanged` — the rebuilt entry equals the live one, or a concurrent Save
   * closed the edit first; either way nothing was posted.
   * `reposted` — the live entry was reversed (or was already gone) and the
   * document posted again.
   * `not_posted` — accounting is off, so there is no entry to keep up to date.
   * `saved` — the family has no entry of its own; the edit is simply closed.
   */
  outcome: 'unchanged' | 'reposted' | 'not_posted' | 'saved'
  /** The entry's document number, when there is one. */
  docNumber: string | null
  /** Always `null`: the document is locked again. The card stamps it on the record. */
  edit: null
}

/**
 * Save the edit.
 *
 * When the rebuilt entry's lines equal the live posting's, nothing is posted: a
 * Save that only fixed a description would otherwise leave a reversal and its
 * twin in the books.
 */
export async function saveDocumentEdit(
  db: Database,
  input: DocumentEditInput
): Promise<SaveDocumentEditResult> {
  const { organizationId, family, entityInstanceId, userId } = input
  const row = documentEditRow(family)

  if (!(await readEditStamp(db, organizationId, entityInstanceId))) {
    throw new ConflictError(
      `This ${family.replace(/_/g, ' ')} is not open for editing, so there is nothing to save. ` +
        'Press Edit first.',
      { family, entityInstanceId }
    )
  }

  if (!row.ledger) return saveWithoutLedger(db, row, input)

  const doc = await row.load(db, organizationId, entityInstanceId)
  if (row.editRefusedIn.includes(doc.status)) {
    throw new BadRequestError(row.refuseEdit(doc), { family, entityInstanceId, status: doc.status })
  }
  assertSaveFloor(row, doc, family, entityInstanceId)

  const plan = await doc.plan(db)
  const ledgerState = await readDocumentLedgerState(db, organizationId, entityInstanceId)
  const built = plan.build(ledgerState.generation)

  const postings = await row.listPostings(db, { organizationId, entityInstanceId })
  const live = postings.filter(
    (posting) => posting.postingType === row.postingType && posting.status !== 'reversed'
  )

  const close = async () => {
    await deleteEditSnapshot(db, organizationId, entityInstanceId)
    await publishStamp(organizationId, family, entityInstanceId)
  }

  // Post-commit, on the pool connection: the projection re-reads the money model
  // against committed truth, exactly as the payment rails call it.
  const reproject = async () => {
    await row.afterSave?.(db, { organizationId, userId, entityInstanceId })
  }

  // Finalized with no live entry: post from current values; Post refuses a finalized document (73 D13).
  if (live.length === 0) {
    const post = await built.post(db, { actorUserId: userId, memo: row.restoredMemo(doc) })
    if (!post) {
      await close()
      await reproject()
      return { outcome: 'not_posted', docNumber: null, edit: null }
    }
    if (!didLedgerAccept(post) && post.status !== 'nothing_to_recognise') {
      throw new BadRequestError(
        `This ${row.noun} could not be posted to the general ledger again` +
          `${post.error ? `: ${post.error}` : ` (${post.status})`}. Nothing has been changed.`,
        { family, entityInstanceId, status: post.status }
      )
    }
    await close()
    await reproject()
    logger.info('Posted a document that had no live entry', {
      organizationId,
      family,
      entityInstanceId,
      internalNumber: doc.internalNumber,
      generation: ledgerState.generation,
      docNumber: post.docNumber,
    })
    return { outcome: 'reposted', docNumber: post.docNumber ?? null, edit: null }
  }

  if (
    live.length === 1 &&
    entryLinesEqual(built.entry, await readBuiltEntry(db, organizationId, live[0]!.glPostingId))
  ) {
    await close()
    logger.info('Saved a document edit with no ledger consequence', {
      organizationId,
      family,
      entityInstanceId,
      internalNumber: doc.internalNumber,
    })
    return { outcome: 'unchanged', docNumber: live[0]!.docNumber, edit: null }
  }

  const lock = await resolvePeriodLock(organizationId)
  const committed = await db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, organizationId)
    // The poster and the reverser each open a transaction of their own. Handed
    // the caller's, those become savepoints on THIS connection, so the advisory
    // lock above is re-entered rather than waited on and the pair is atomic.
    const txDb = tx as unknown as Database

    // Both preconditions are re-read UNDER the lock: two concurrent Saves both
    // pass them outside it, and the loser would reverse an entry the winner has
    // already replaced and repost at a colliding generation (74 §7 acceptance 4).
    if (!(await readEditStamp(txDb, organizationId, entityInstanceId))) {
      return { saved: false as const, docNumber: live[0]?.docNumber ?? null }
    }
    const locked = await readDocumentLedgerState(txDb, organizationId, entityInstanceId)

    let reversed = false
    for (const posting of live) {
      const reversal = await reverseEntry(txDb, {
        organizationId,
        glPostingId: posting.glPostingId,
        actorUserId: userId,
        lock,
        memo: row.reversalMemo(doc, posting.docNumber),
      })
      if (!didLedgerAccept(reversal)) {
        throw new BadRequestError(
          `This ${row.noun}'s entry (${posting.docNumber}) could not be reversed` +
            `${reversal.error ? `: ${reversal.error}` : ` (${reversal.status})`}, so the edit ` +
            'cannot be saved. Nothing has been changed.',
          { family, entityInstanceId, docNumber: posting.docNumber, status: reversal.status }
        )
      }
      reversed = true
    }

    // Reversing DELETED the subject claim but LEFT the original's document
    // number in the books, and that number is unique per org - so the repost
    // moves to the next generation and keys on it.
    const generation = reversed ? locked.generation + 1 : locked.generation
    // `built` was made from the pre-lock generation; rebuild whenever the one
    // under the lock is not it.
    const entry = generation === ledgerState.generation ? built : plan.build(generation)

    const post = await entry.post(txDb, { actorUserId: userId, memo: row.repostMemo(doc) })
    if (post && !didLedgerAccept(post) && post.status !== 'nothing_to_recognise') {
      throw new BadRequestError(
        `This ${row.noun} could not be re-posted to the general ledger` +
          `${post.error ? `: ${post.error}` : ` (${post.status})`}. Nothing has been changed.`,
        { family, entityInstanceId, status: post.status }
      )
    }

    if (generation !== locked.generation) {
      await writeDocumentLedgerGeneration(txDb, organizationId, entityInstanceId, generation)
    }
    await deleteEditSnapshot(txDb, organizationId, entityInstanceId)
    return { saved: true as const, docNumber: post?.docNumber ?? null }
  })

  // The other Save won the lock and closed the edit: there is nothing left to
  // save, and its stamp has already been published.
  if (!committed.saved) {
    return { outcome: 'unchanged', docNumber: committed.docNumber, edit: null }
  }

  await publishStamp(organizationId, family, entityInstanceId)
  await reproject()
  logger.info('Re-posted a document after an edit', {
    organizationId,
    family,
    entityInstanceId,
    internalNumber: doc.internalNumber,
    docNumber: committed.docNumber,
  })
  return { outcome: 'reposted', docNumber: committed.docNumber, edit: null }
}

/** A family with no entry of its own: Save only closes the edit (66 §2.3). */
async function saveWithoutLedger(
  db: Database,
  row: PlainDocumentEditRow,
  input: DocumentEditInput
): Promise<SaveDocumentEditResult> {
  const { organizationId, family, entityInstanceId, userId } = input
  const doc = await row.load(db, organizationId, entityInstanceId)
  if (row.editRefusedIn.includes(doc.status)) {
    throw new BadRequestError(row.refuseEdit(doc), { family, entityInstanceId, status: doc.status })
  }
  await deleteEditSnapshot(db, organizationId, entityInstanceId)
  await publishStamp(organizationId, family, entityInstanceId)
  await row.afterSave?.(db, { organizationId, userId, entityInstanceId })
  logger.info('Saved a document edit', { organizationId, family, entityInstanceId })
  return { outcome: 'saved', docNumber: null, edit: null }
}

/**
 * The one refusal that lands before the ledger is touched (73 D4): the new total
 * may not fall below what has been settled, or the document's balance goes
 * negative against a record saying the opposite.
 */
function assertSaveFloor(
  row: DocumentEditRow,
  doc: DocumentEditDoc,
  family: string,
  entityInstanceId: string
): void {
  if (doc.settledMinor > 0 && doc.totalMinor < doc.settledMinor) {
    throw new ConflictError(row.refuseBelowFloor(doc), {
      family,
      entityInstanceId,
      totalMinor: String(doc.totalMinor),
      settledMinor: String(doc.settledMinor),
    })
  }
}

async function publishStamp(
  organizationId: string,
  family: string,
  entityInstanceId: string
): Promise<void> {
  const entityDefinitionId = await getCachedEntityDefId(organizationId, family)
  if (!entityDefinitionId) return
  await publishRecordEditStamp({
    organizationId,
    entityDefinitionId,
    entityInstanceId,
    edit: null,
  })
}

/** The stored `BuiltEntry` of one posting, or `null` when it cannot be read. */
export async function readBuiltEntry(
  db: Database,
  organizationId: string,
  glPostingId: string
): Promise<BuiltEntry | null> {
  const [row] = [...(await readPostingHeaders(db, organizationId, [glPostingId])).values()]

  const built = row?.built
  if (!built || typeof built !== 'object') return null
  const entry = (built as Record<string, unknown>).entry
  return entry && typeof entry === 'object' ? (entry as BuiltEntry) : null
}

/**
 * Do these two entries say the same thing?
 *
 * The date and the line set, compared on what a ledger line IS — its account,
 * its side, its amount and what it is sourced on. The memo is deliberately not
 * compared: re-posting a whole entry because somebody fixed a typo in a line
 * description would leave a reversal pair in the books for a change with no
 * accounting content. An unreadable stored entry compares as different, so the
 * Save reposts rather than silently doing nothing.
 */
export function entryLinesEqual(next: BuiltEntry, live: BuiltEntry | null): boolean {
  if (!live) return false
  if (next.txnDate !== live.txnDate) return false
  const a = next.lines.map(lineKey).sort()
  const b = (live.lines ?? []).map(lineKey).sort()
  return a.length === b.length && a.every((key, index) => key === b[index])
}

/** One line reduced to the facts the ledger keeps. */
function lineKey(line: GlPostingLineInput): string {
  const account = line.glAccountId ?? line.accountCode ?? line.accountRole ?? ''
  return `${account}|${line.direction}|${line.amount}|${line.sourceId ?? ''}`
}
