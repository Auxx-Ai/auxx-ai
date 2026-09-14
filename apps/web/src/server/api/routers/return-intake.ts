// apps/web/src/server/api/routers/return-intake.ts
//
// The API surface for the return-label intake wizard
// (plans/money/tasks/57-return-intake-wizard.md).
//
// 🛑 **Every procedure here is the permission gate for the lib call underneath.**
// `@auxx/lib/returns/intake` contains no access checks by design
// (docs/lib-module-guide.md §6), so a gate missing here is missing everywhere.
//
// | procedure                                          | gate                |
// | -------------------------------------------------- | ------------------- |
// | `checkCapability`, `start`, `get`, `confirmLabel`, `orderOptions` | **view** on `return` |
// | `commit`, `patchLabelTranscription`                 | **edit** on `return` |
//
// 🛑 The read/draft group gating on VIEW is deliberate, and it is
// `purchasing.ts`'s argument for the same split. Those five procedures write an
// intake DRAFT and nothing else: a draft is a Redis key with a 24-hour TTL, it
// mints no `RMA-…`, appears in no list, and self-collects (§6.1). Requiring edit
// there would mean a dock hand who may not raise returns cannot photograph a
// pallet for somebody who can — and `commit`, the one procedure that creates
// records, is where the create authority actually belongs.
//
// 🛑 `patchLabelTranscription` is the ONE draft write that gates on EDIT, and the
// split is the reason why: the other five record what was *found* (a phase, a
// model's read, the ladder's candidates, who the reviewer picked), while this one
// records what somebody *asserts is printed on the box*. Those typed values go
// onto the return verbatim as `senderNameRaw` / `senderAddressRaw` — they are the
// only identifying thing an unannounced pallet carries (§4.6) — so authoring them
// is the same authority as raising the return that will carry them.
//
// Lib returns neverthrow `Result`s carrying `AuxxError`s, which are rethrown
// as-is so `auxxErrorMiddleware` maps them. Wrapping one in a `TRPCError` would
// flatten a 409 or a 422 into a 500 — which is why the one `try/catch` below
// guards its rethrow with `isAuxxError`, never `e instanceof TRPCError`.

import { getCachedEntityDefId } from '@auxx/lib/cache'
import { NotFoundError } from '@auxx/lib/errors'
import {
  checkReturnIntakeModelCapability,
  commitReturnIntakeDraft,
  confirmReturnIntakeLabel,
  createReturnIntakeDraft,
  discardReturnIntakeDraft,
  getReturnIntakeDraft,
  patchReturnIntakeLabelTranscription,
  RETURN_INTAKE_MAX_LABELS,
  readOrderOptionsForContact,
  setReturnIntakeOrderOptions,
} from '@auxx/lib/returns/intake'
import { recordIdSchema } from '@auxx/types/resource'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter, isAuxxError } from '~/server/api/trpc'

/** The definition id, or the message a brand-new org should see rather than a 500. */
async function requireDefId(organizationId: string, entityType: string): Promise<string> {
  const defId = await getCachedEntityDefId(organizationId, entityType)
  if (!defId) {
    throw new NotFoundError(`This organization has no ${entityType} records yet.`)
  }
  return defId
}

export const returnIntakeRouter = createTRPCRouter({
  /**
   * Can this organization's default model look at a photograph at all?
   *
   * 🛑 The dialog asks this **on open**, before it offers a file picker (§7.2).
   * Refusing after a worker has walked to the dock and photographed twenty
   * parcels is the bad version of the same refusal — the same sentence, spent at
   * the least useful moment.
   */
  // `.optional()` so both `useQuery()` and `useQuery({})` typecheck on the
  // client — the procedure takes nothing either way.
  checkCapability: capabilityProcedure.input(z.object({}).optional()).query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'return'))

    const result = await checkReturnIntakeModelCapability(ctx.db, organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * Take a drop of uploaded label photos and start reading them (§3).
   *
   * Two steps and no third: create the draft, enqueue the job. Twenty labels are
   * twenty model calls, minutes rather than a mutation, so what comes back is the
   * `draftId` the dialog polls and the review route is addressed by. The draft
   * exists before the enqueue on purpose — the job's stable `jobId` is built from
   * it, and a message pointing at a key that is not there yet is a race with
   * nothing to gain.
   *
   * ⚠️ `RETURN_INTAKE_MAX_LABELS` is enforced here as well as in the drop zone:
   * a dock pallet, not a bulk import.
   */
  start: capabilityProcedure
    .input(
      z.object({
        labels: z
          .array(
            z.object({
              /** `asset:<mediaAssetId>` — the temp upload the custom-field door left. */
              fileRef: z.string().min(1).max(255),
              fileName: z.string().min(1).max(500),
            })
          )
          .min(1)
          .max(RETURN_INTAKE_MAX_LABELS),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'return'))

      const draft = await createReturnIntakeDraft(organizationId, userId, input)
      if (draft.isErr()) throw draft.error

      const { enqueueReturnIntake } = await import('@auxx/lib/jobs')
      await enqueueReturnIntake({ organizationId, userId, draftId: draft.value.draftId })

      return draft.value
    }),

  /**
   * The draft as the dialog and the review route read it.
   *
   * Polled while `status` is `reading` — `phase` plus `labelsRead` / `labelsTotal`
   * are what turn a two-minute wait into a checklist rather than a spinner
   * (§6.2).
   */
  get: capabilityProcedure
    .input(z.object({ draftId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'return'))

      const result = await getReturnIntakeDraft(organizationId, input.draftId)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * The worker's answer for ONE label.
   *
   * Per label rather than a whole-payload save, because §5.3 makes the answers
   * the unit: ask per label, then group, then show "3 labels → 2 returns" with
   * the split visible before commit. A whole-payload save would let a stale tab
   * overwrite a colleague's answers on a URL two people can legitimately have
   * open at once (§7.2).
   *
   * 🛑 `unidentified: true` is an ANSWER, not an absence — see the lib writer.
   */
  confirmLabel: capabilityProcedure
    .input(
      z.object({
        draftId: z.string().min(1),
        labelId: z.string().min(1),
        contactRecordId: recordIdSchema.nullable().default(null),
        orderRecordId: recordIdSchema.nullable().default(null),
        unidentified: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'return'))

      const { draftId, ...answer } = input
      const result = await confirmReturnIntakeLabel(organizationId, draftId, answer)
      if (result.isErr()) throw result.error
      return { ok: true as const }
    }),

  /**
   * Type a label in by hand, when the model could not read it (§4.6).
   *
   * 🛑 Without this, a worker who confirms an unreadable label as "not one of
   * ours" creates a return with an EMPTY `senderNameRaw` and `senderAddressRaw`.
   * §4.6 is explicit that both are filled from the label, and the unannounced
   * pallet — about 15% of Auxx-Lift's returns — is the case this feature exists
   * for. A record with nothing identifying on it is not a booking, it is a
   * rumour.
   *
   * ⚠️ **A PARTIAL patch.** A worker can often read the street and not the name.
   * An absent key leaves what is there alone; a null or blank one clears that
   * field. The lib writer merges rather than replaces.
   *
   * 🛑 `legible` is not accepted and cannot be: it is the model's own answer, and
   * letting a client set it would present typed text as a machine read. See
   * `patchReturnIntakeLabelTranscription`.
   */
  patchLabelTranscription: capabilityProcedure
    .input(
      z.object({
        draftId: z.string().min(1),
        labelId: z.string().min(1),
        // `.nullish()` per field so "not sent" and "cleared" stay different
        // answers all the way down to the writer.
        senderName: z.string().max(500).nullish(),
        senderStreet1: z.string().max(500).nullish(),
        senderStreet2: z.string().max(500).nullish(),
        senderCity: z.string().max(500).nullish(),
        senderRegion: z.string().max(500).nullish(),
        senderPostalCode: z.string().max(100).nullish(),
        senderCountry: z.string().max(200).nullish(),
        carrier: z.string().max(200).nullish(),
        trackingNumber: z.string().max(200).nullish(),
        ourReferenceRaw: z.string().max(200).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'return'))

      const { draftId, labelId, ...patch } = input
      const result = await patchReturnIntakeLabelTranscription(
        organizationId,
        draftId,
        labelId,
        patch
      )
      if (result.isErr()) throw result.error
      return { ok: true as const }
    }),

  /**
   * The orders a confirmed contact could be returning against (§4.5).
   *
   * Read and cached onto the draft in one call: the picker needs the list
   * immediately after a confirmation, and storing it means reopening the review
   * route does not re-query for every label the same customer sent.
   *
   * Caching onto the draft is best-effort — the list is what the caller asked
   * for and a Redis hiccup must not cost them the picker.
   */
  orderOptions: capabilityProcedure
    .input(z.object({ draftId: z.string().min(1), contactRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'return'))

      const options = await readOrderOptionsForContact(
        ctx.db,
        organizationId,
        input.contactRecordId
      )
      if (options.isErr()) throw options.error

      await setReturnIntakeOrderOptions(
        organizationId,
        input.draftId,
        input.contactRecordId,
        options.value
      )

      return options.value
    }),

  /**
   * Turn the confirmed groups into returns (§6.3).
   *
   * 🛑 The ONE procedure in this router that gates on EDIT, and the only one that
   * writes records. It goes through `createReturn` so the RecordSequence hook
   * mints `RMA-…` and both guard chains run.
   *
   * ⚠️ **Never throws for a group that refused.** Commit is per group and partial
   * failure is real: three groups and the second refuses means the first is
   * already a real RMA. The result array carries one entry per requested group,
   * and the draft still holds the labels of the ones that failed — so the
   * success path and the partial-failure path are the same path, and the review
   * screen renders what happened rather than a toast that hides two good RMAs.
   */
  commit: capabilityProcedure
    .input(
      z.object({
        draftId: z.string().min(1),
        groupIds: z.array(z.string().min(1)).min(1).max(RETURN_INTAKE_MAX_LABELS),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'return'))

      const result = await commitReturnIntakeDraft(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Abandon a drop. Leaves no records behind, because there were never any
   * (§6.1) — the label photos it points at expire on their own 24-hour fuse and
   * the upload sweep collects them.
   *
   * The `try/catch` exists only to say something better than a 500 when the key
   * is already gone, which is the common case for a Discard pressed twice.
   * 🛑 The rethrow is guarded with `isAuxxError`, never `instanceof TRPCError`:
   * an `AuxxError` caught and rewrapped loses its status.
   */
  discard: capabilityProcedure
    .input(z.object({ draftId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'return'))

      try {
        const result = await discardReturnIntakeDraft(organizationId, input.draftId)
        if (result.isErr()) throw result.error
        return { ok: true as const }
      } catch (error) {
        if (isAuxxError(error)) throw error
        throw new NotFoundError('This label drop is no longer available')
      }
    }),
})
