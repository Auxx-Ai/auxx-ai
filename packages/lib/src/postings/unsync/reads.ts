// packages/lib/src/postings/unsync/reads.ts
//
// Eligibility (R1-R4) and the remote comparison (R5) for un-syncing a delivered
// journal - plans/accounting/tasks/60-un-syncing-from-the-provider.md §3, §5.1.
//
// 🛑 Reads only. Nothing here writes a column, which is what makes E4
// ("delete first, reset second") checkable by reading one file.
//
// No permission checks. The router asserts `ledgerControl` (docs/lib-module-guide.md §6).

import { type Database, schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { UnprocessableEntityError } from '../../errors'
import { resolveQuickbooksContext } from '../../money/quickbooks/invoke-quickbooks-tool'
import { withAccountingCommitLock } from '../accounting-commit-lock'

/** Everything one withdrawal needs, gathered once under the commit lock. */
export interface UnsyncTarget {
  glPostingId: string
  docNumber: string
  deliveryId: string
  bookId: string
  /** The epoch the delivery is at NOW. The withdrawal is keyed at this plus one. */
  attemptEpoch: number
  /** The `ExternalAccountingObject` row that records what we created. */
  objectId: string
  externalId: string
  /** The version we recorded when we created it - R5 compares against this. */
  remoteVersion: string | null
}

/** Eligible, or one of R1-R4 with the sentence the queue renders on the row. */
export type UnsyncEligibility =
  | { eligible: true; docNumber: string; target: UnsyncTarget }
  | { eligible: false; docNumber: string | null; reason: string }

/**
 * Apply R1-R4 to one posting.
 *
 * Under `withAccountingCommitLock` so the picture cannot shift between the
 * refusals and the withdrawal they authorize - the same lock every other writer
 * of these three tables takes.
 *
 * 🛑 `assertPeriodOpen` is deliberately absent and must not be added. A closed
 * month's provider copy is still ours to withdraw; whether THEIR books are
 * closed is R6, and it is their answer to give (§3).
 */
export async function readUnsyncTarget(
  db: Database,
  input: { organizationId: string; glPostingId: string; providerLabel: string }
): Promise<UnsyncEligibility> {
  const { organizationId, glPostingId, providerLabel } = input

  return db.transaction(async (tx) => {
    await withAccountingCommitLock(tx, organizationId)

    const [posting] = await tx
      .select({
        id: schema.GlPosting.id,
        docNumber: schema.GlPosting.docNumber,
        status: schema.GlPosting.status,
        exportStatus: schema.GlPosting.exportStatus,
        deliveryIntent: schema.GlPosting.deliveryIntent,
      })
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          eq(schema.GlPosting.id, glPostingId)
        )
      )
      .limit(1)

    if (!posting) return { eligible: false, docNumber: null, reason: 'Not found.' } as const
    const doc = posting.docNumber

    // R1. A `failed` row uses Retry; a held row is already un-synced.
    if (posting.exportStatus !== 'exported')
      return {
        eligible: false,
        docNumber: doc,
        reason: `${doc} was never sent, so there is nothing to remove.`,
      } as const

    // R2. Dev residue only - E7.
    if (posting.deliveryIntent === null)
      return {
        eligible: false,
        docNumber: doc,
        reason: `${doc} predates the delivery pipeline and has no recorded provider object.`,
      } as const

    const [delivery] = await tx
      .select({
        id: schema.AccountingDelivery.id,
        bookId: schema.AccountingDelivery.bookId,
        attemptEpoch: schema.AccountingDelivery.attemptEpoch,
      })
      .from(schema.AccountingDelivery)
      .where(
        and(
          eq(schema.AccountingDelivery.organizationId, organizationId),
          eq(schema.AccountingDelivery.glPostingId, glPostingId)
        )
      )
      .limit(1)

    const missingObject = {
      eligible: false,
      docNumber: doc,
      reason: `We have no record of what was created in ${providerLabel}, so nothing can be removed safely.`,
    } as const

    // R3.
    if (!delivery) return missingObject

    const [object] = await tx
      .select({
        id: schema.ExternalAccountingObject.id,
        externalId: schema.ExternalAccountingObject.externalId,
        remoteVersion: schema.ExternalAccountingObject.remoteVersion,
      })
      .from(schema.ExternalAccountingObject)
      .innerJoin(
        schema.AccountingDeliveryOperation,
        and(
          eq(
            schema.AccountingDeliveryOperation.organizationId,
            schema.ExternalAccountingObject.organizationId
          ),
          eq(schema.AccountingDeliveryOperation.id, schema.ExternalAccountingObject.operationId)
        )
      )
      .where(
        and(
          eq(schema.ExternalAccountingObject.organizationId, organizationId),
          eq(schema.AccountingDeliveryOperation.deliveryId, delivery.id),
          eq(schema.ExternalAccountingObject.objectType, 'journal'),
          // A row withdrawn at an earlier epoch keeps its row (the audit is the
          // point) and must not be offered up as this epoch's live copy.
          isNull(schema.ExternalAccountingObject.withdrawnAt)
        )
      )
      .limit(1)

    if (!object) return missingObject

    // R4. Removing one half of a pair leaves the provider unbalanced.
    const [reversal] = await tx
      .select({ docNumber: schema.GlPosting.docNumber })
      .from(schema.GlPosting)
      .where(
        and(
          eq(schema.GlPosting.organizationId, organizationId),
          eq(schema.GlPosting.reversesId, glPostingId)
        )
      )
      .limit(1)
    if (reversal || posting.status === 'reversed')
      return {
        eligible: false,
        docNumber: doc,
        reason:
          `${doc} has been reversed by ${reversal?.docNumber ?? 'its reversal'}. Un-sync the pair ` +
          `or neither - removing one half leaves ${providerLabel} holding an unbalanced correction.`,
      } as const

    return {
      eligible: true,
      docNumber: doc,
      target: {
        glPostingId,
        docNumber: doc,
        deliveryId: delivery.id,
        bookId: delivery.bookId,
        attemptEpoch: delivery.attemptEpoch,
        objectId: object.id,
        externalId: object.externalId,
        remoteVersion: object.remoteVersion,
      },
    } as const
  })
}

/** What the provider currently holds for one object we created. */
export interface RemoteJournalSnapshot {
  /** False means the provider no longer holds it - the delete has already landed. */
  present: boolean
  /** The provider's version of it right now. Null when it is gone. */
  remoteVersion: string | null
  raw: Record<string, unknown> | null
}

/**
 * Look one delivered journal up in the provider, by the document number.
 *
 * ⚠️ The lookup is by `DocNumber` rather than by id because that is the query
 * the provider actually supports, and because it is the same readback the create
 * path proves itself with (`delivery.ts`) - an absent answer means the copy is
 * gone, which is what both §5.1 step 4 and §2.4's recovery need to know.
 *
 * 🛑 The body is QuickBooks-specific while the signature is not. `withdrawObject`
 * is on the provider interface but no neutral "read one object" is, so this
 * mirrors what `delivery.ts` already does rather than widening the interface
 * outside this unit's scope.
 */
export async function readRemoteJournal(input: {
  organizationId: string
  providerLabel: string
  docNumber: string
  externalId: string
}): Promise<Result<RemoteJournalSnapshot, Error>> {
  const resolved = await resolveQuickbooksContext({ organizationId: input.organizationId })
  if (!resolved.connected)
    return err(
      new UnprocessableEntityError(
        `${input.providerLabel} is not connected, so there is nothing to remove from it.`,
        { organizationId: input.organizationId, externalId: input.externalId }
      )
    )

  try {
    const found = (await resolved.context.callTool('find_quickbooks_journal_entry', {
      docNumber: input.docNumber,
      limit: 2,
    })) as { journalEntries?: unknown } | undefined
    if (!Array.isArray(found?.journalEntries))
      return err(
        new Error(`${input.providerLabel} did not answer a complete lookup for ${input.docNumber}.`)
      )

    const entries = found.journalEntries as Record<string, unknown>[]
    // Matched on the id we recorded, never on position: a second entry sharing
    // the document number is somebody else's row and removing it is not ours to do.
    const mine = entries.find((entry) => String(entry.journalEntryId ?? '') === input.externalId)
    if (!mine) return ok({ present: false, remoteVersion: null, raw: null })
    return ok({
      present: true,
      remoteVersion: typeof mine.syncToken === 'string' ? mine.syncToken : null,
      raw: mine,
    })
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
