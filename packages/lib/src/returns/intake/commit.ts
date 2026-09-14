// packages/lib/src/returns/intake/commit.ts

/**
 * Step 4 (plans/money/tasks/57 §6.3): the draft becomes returns.
 *
 * 🛑 **Through `createReturn`, never a bespoke insert.** That is the same
 * function `apps/web/src/server/api/routers/return.ts`'s `create` calls, and
 * going around it costs two things at once: `return.number` is minted by the
 * RecordSequence hook inside `UnifiedCrudHandler.create`, so an insert of our
 * own produces a return with no `RMA-…`; and both guard chains the writer runs
 * (relationship definitions that exist, the field context) are skipped
 * (54 §11 item 3).
 *
 * 🛑 **The header only. No `return_line` rows.** The lines card #2147 shipped
 * already has "Add from order" and the returnable-quantity ceiling, so writing
 * lines here would be a second implementation of a grid that exists — and worse,
 * it would mix *what arrived* (a parcel with a label on it) with *what is in the
 * box* (a sold line, a quantity, a condition), which 54 §3.3 deliberately
 * separated into different statuses.
 *
 * 🛑 **Per group, each in its OWN transaction.** Partial failure is real: three
 * groups and the second refuses means the first is already a real RMA with a
 * real number. One transaction around all three would roll back two returns that
 * were fine because a third label was unreadable, and the dock worker would be
 * left with three parcels and nothing booked. Each group therefore commits
 * alone, reports its own {@link ReturnIntakeCommitResult}, and the draft keeps
 * the labels of the groups that failed so a retry aims at those and not at the
 * ones that worked.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseFileRef } from '@auxx/types/file-ref'
import { parseRecordId } from '@auxx/types/resource'
import type { Result } from 'neverthrow'
import { AuxxError, ConflictError, NotFoundError, UnprocessableEntityError } from '../../errors'
import { convertTempAssetToPermanent } from '../../files/assets/asset-mutations'
import { UnifiedCrudHandler } from '../../resources/crud/unified-handler'
import { createReturn } from '../writes'
import {
  formatSenderAddress,
  type ReturnIntakeCommitInput,
  type ReturnIntakeCommitResult,
  type ReturnIntakeGroup,
  type ReturnIntakeLabel,
} from './client'
import { recordReturnIntakeCommit } from './draft-mutations'
import { readStoredReturnIntakeDraft } from './draft-queries'
import { groupLabels } from './group'
import { guard } from './guard'

const logger = createScopedLogger('returns:intake:commit')

/**
 * The first non-empty answer across a group's labels.
 *
 * 🛑 First, not merged. `senderNameRaw` and `senderAddressRaw` are EVIDENCE —
 * what one label said, verbatim — and concatenating two labels' sender blocks
 * would produce a string no label ever carried. Two parcels from the same
 * customer normally print the same sender anyway; when they do not, the first
 * one is at least a thing that was really printed on a real box.
 */
function firstOf<T>(
  labels: ReturnIntakeLabel[],
  pick: (label: ReturnIntakeLabel) => T | null
): T | null {
  for (const label of labels) {
    const value = pick(label)
    if (value !== null && value !== undefined && value !== '') return value
  }
  return null
}

/**
 * Every tracking number in the group, in label order, de-duplicated.
 *
 * ⚠️ ALL of them, which is what `return.inboundTracking` going multi-value
 * (entity migration 155, §8.1) is for: one customer's return routinely arrives
 * as three parcels on three waybills, and keeping only the first would lose the
 * two a warehouse would actually go looking for.
 *
 * 🛑 Recorded as an accepted limitation in §6.4: with tracking as a flat
 * multi-value scalar and photos as a flat attachment list, **which photo shows
 * which parcel's label is not recorded**. The `return_parcel` child definition
 * §8.2 describes is what fixes that, and it was rejected for v1 on the owner's
 * call — not forgotten.
 */
function trackingNumbersOf(labels: ReturnIntakeLabel[]): string[] {
  const seen = new Set<string>()
  for (const label of labels) {
    const tracking = label.transcription?.trackingNumber?.trim()
    if (tracking) seen.add(tracking)
  }
  return [...seen]
}

/** `defId:instanceId` → the instance id `createReturn` takes for a relationship. */
function instanceIdOf(recordId: string | null): string | null {
  return recordId ? parseRecordId(recordId as never).entityInstanceId : null
}

/**
 * Create one return for one group, inside one transaction.
 *
 * The photo link is a second write rather than an argument to `createReturn`
 * because `ReturnInput` has no `photos` key — the field is `FILE` /
 * `allowMultiple` and every other writer of it is the Documents card. Both
 * writes share this function's transaction, so a return whose photos failed to
 * attach never reaches the database: the label photograph IS the evidence for a
 * dock surprise, and a return that cannot show it is worse than no return.
 */
async function commitGroup(
  db: Database,
  organizationId: string,
  userId: string,
  group: ReturnIntakeGroup,
  labels: ReturnIntakeLabel[],
  receivedAt: Date
): Promise<{ returnRecordId: string; returnNumber: string | null }> {
  let returnRecordId = ''
  let returnNumber: string | null = null

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database

    const created = await createReturn(txDb, organizationId, userId, {
      senderNameRaw: firstOf(labels, (label) => label.transcription?.senderName ?? null),
      senderAddressRaw: firstOf(labels, (label) =>
        label.transcription ? formatSenderAddress(label.transcription) : null
      ),
      inboundCarrier: firstOf(labels, (label) => label.transcription?.carrier ?? null),
      inboundTracking: trackingNumbersOf(labels),
      contactId: instanceIdOf(group.contactRecordId),
      orderId: instanceIdOf(group.orderRecordId),
      // 🛑 Always `dock`. This wizard IS the dock door (§7.1) — a return a
      // customer asked for starts from the ticket and carries `email`; a return
      // that showed up starts from a photograph.
      origin: 'dock',
      // 🛑 `received`, NOT the definition default.
      //
      // `RETURN_ENTRY_STATUSES` is `['requested', 'received']` and
      // `return-hooks.ts` names this exact case: "A dock surprise — about 15% of
      // Auxx-Lift's returns — enters at `received` with `contact` null, because
      // the pallet is on the floor before anyone knows whose it is."
      //
      // Taking the default would enter at `requested`, which is both wrong and
      // a TRAP: `requested` says somebody asked about a return, and the physical
      // graph only reaches `received` through `approved -> in_transit`. A dock
      // return left at `requested` could not be moved to where it already
      // physically is without walking two transitions that never happened.
      status: 'received',
      // The parcel is physically here: somebody just photographed it.
      receivedAt,
    })
    if (created.isErr()) throw created.error

    returnRecordId = created.value.recordId
    returnNumber = created.value.number

    const crud = new UnifiedCrudHandler(organizationId, userId, txDb)
    await crud.update(created.value.recordId, {
      return_photos: labels.map((label) => ({ ref: label.fileRef })),
    })
  })

  return { returnRecordId, returnNumber }
}

/**
 * Take the group's photos off their 24-hour fuse.
 *
 * ⚠️ Best-effort and deliberately AFTER the transaction. The return exists and
 * has a number; reporting failure for work that succeeded would send the worker
 * back to press Create again, be told the labels are gone, and raise the return
 * by hand — a duplicate RMA arriving through the front door, which is exactly
 * what the per-group commit ordering exists to prevent.
 *
 * ⚠️ The fuse itself is a PRE-EXISTING, PRODUCT-WIDE defect, not one this
 * feature introduced: `convertTempAssetToPermanent` is never called on the
 * `CUSTOM_FIELD` upload path at all, so every field upload in the product is
 * already in this state (`docs/files-upload-architecture-guide.md` §12). Calling
 * it here is intake being better-behaved than the rest of the app, so a failure
 * returns us to the status quo rather than to a broken state.
 */
async function makePhotosPermanent(
  db: Database,
  organizationId: string,
  labels: ReturnIntakeLabel[],
  meta: Record<string, unknown>
): Promise<void> {
  for (const label of labels) {
    const { sourceType, id: assetId } = parseFileRef(label.fileRef as never)
    if (sourceType !== 'asset' || !assetId) continue
    try {
      // `DOCUMENT`, not an image kind: `AssetKind` has no plain `IMAGE` — its
      // image members are `INLINE_IMAGE` (email bodies), `THUMBNAIL` and
      // `USER_AVATAR`, none of which a field attachment is. `DOCUMENT` is what
      // the quote intake writes for the same reason.
      const converted = await convertTempAssetToPermanent(
        { db, organizationId },
        assetId,
        'DOCUMENT'
      )
      if (converted.isErr()) throw converted.error
    } catch (error) {
      logger.error('Raised a return but could not make its label photo permanent', {
        error,
        organizationId,
        assetId,
        ...meta,
      })
    }
  }
}

/**
 * Turn the confirmed groups of a reviewed draft into returns.
 *
 * @returns one {@link ReturnIntakeCommitResult} per requested group, in the
 *   order the groups were requested. A group that refused carries its message
 *   and a null `returnRecordId`, and its labels are still in the draft.
 */
export async function commitReturnIntakeDraft(
  db: Database,
  organizationId: string,
  userId: string,
  input: ReturnIntakeCommitInput
): Promise<Result<ReturnIntakeCommitResult[], Error>> {
  return guard(
    async () => {
      // 🛑 Keyed by the CALLER's organizationId. That key prefix is the whole org
      // scope — there is no row predicate behind it — so a draft id from another
      // org resolves to nothing rather than to somebody else's dock.
      const draft = await readStoredReturnIntakeDraft(organizationId, input.draftId)
      if (!draft) throw new NotFoundError('This label drop is no longer available')
      if (draft.status === 'committed') {
        throw new ConflictError('These labels have already been made into returns')
      }
      if (draft.status !== 'ready') {
        throw new UnprocessableEntityError('These labels have not been read yet')
      }

      // 🛑 Regrouped from the CONFIRMATIONS in the draft, never from group ids the
      // browser sent. The client names which groups to commit; what each group
      // contains is derived here from the same pure function the review screen
      // rendered, so a stale tab cannot commit a grouping nobody saw (§5.3).
      const groups = groupLabels(draft.payload.labels)
      const byId = new Map(groups.map((group) => [group.id, group]))
      const labelById = new Map(draft.payload.labels.map((label) => [label.id, label]))

      const receivedAt = new Date()
      const results: ReturnIntakeCommitResult[] = []
      const committedLabelIds: string[] = []

      for (const groupId of input.groupIds) {
        const group = byId.get(groupId)
        if (!group) {
          // Already committed on an earlier press, or the confirmations moved
          // under a stale tab. Either way there is nothing to create.
          results.push({
            groupId,
            returnRecordId: null,
            returnNumber: null,
            error: 'These labels are no longer part of this drop',
          })
          continue
        }

        const labels = group.labelIds
          .map((labelId) => labelById.get(labelId))
          .filter((label): label is ReturnIntakeLabel => label != null)

        try {
          const { returnRecordId, returnNumber } = await commitGroup(
            db,
            organizationId,
            userId,
            group,
            labels,
            receivedAt
          )
          committedLabelIds.push(...group.labelIds)
          results.push({
            groupId,
            returnRecordId: returnRecordId as ReturnIntakeCommitResult['returnRecordId'],
            returnNumber,
            error: null,
          })

          await makePhotosPermanent(db, organizationId, labels, {
            draftId: draft.id,
            groupId,
            returnRecordId,
          })
        } catch (error) {
          // ⚠️ Caught per group and NOT rethrown. The groups before this one are
          // already real RMAs; abandoning the loop would leave the ones after it
          // uncommitted with nothing in the result to say so.
          logger.error('Failed to raise a return from a label group', {
            error,
            organizationId,
            draftId: draft.id,
            groupId,
            labels: labels.length,
          })
          results.push({
            groupId,
            returnRecordId: null,
            returnNumber: null,
            error:
              error instanceof AuxxError
                ? error.message
                : 'We could not raise a return for these labels.',
          })
        }
      }

      // One write for every group that worked. 🛑 Never a delete of the key —
      // see `recordReturnIntakeCommit`. A failure here is logged and swallowed:
      // the returns exist, and rethrowing would hide a result set that says
      // exactly which ones.
      if (committedLabelIds.length > 0) {
        const recorded = await recordReturnIntakeCommit(organizationId, draft.id, committedLabelIds)
        if (recorded.isErr()) {
          logger.error('Raised returns but could not update the intake draft', {
            error: recorded.error,
            organizationId,
            draftId: draft.id,
            committed: committedLabelIds.length,
          })
        }
      }

      logger.info('Committed a label drop into returns', {
        organizationId,
        draftId: draft.id,
        requested: input.groupIds.length,
        created: results.filter((result) => result.error === null).length,
        failed: results.filter((result) => result.error !== null).length,
      })

      return results
    },
    'Failed to commit a return intake draft',
    { organizationId, draftId: input.draftId }
  )
}
