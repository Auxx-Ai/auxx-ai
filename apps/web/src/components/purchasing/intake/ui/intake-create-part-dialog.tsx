// apps/web/src/components/purchasing/intake/ui/intake-create-part-dialog.tsx
'use client'

// Tier 4's third ending: create the part the vendor quoted
// (plans/money/tasks/38 §5.2).
//
// `purchase_order_line.part` is `required: true` and leg 2 of the natural key, so
// an unresolved row has exactly three endings — pick a part, create one, or fold
// the amount into a header total. This is the middle one, and it is a thin shell
// around the SAME `PartFormDialog` the parts screens use rather than a second
// create form: a part minted here has to be a real catalogue part, with a Kind,
// a Category and an opening balance, because it will value movements forever.
//
// 🛑 The part IS written here — this is the one thing on the review screen that
// touches the database before commit, and it has to be, because the line needs a
// `RecordId` that exists. Everything else stays in the draft payload: the new
// part's id goes onto the line through the caller's `onPatch`, which is the same
// draft-state write the part PICKER uses.

import type { IntakeLine } from '@auxx/lib/purchasing/intake/client'
import { type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { useCallback, useMemo } from 'react'
import {
  PartFormDialog,
  type PartFormPrefill,
} from '~/components/manufacturing/parts/part-form-dialog'
import type { PartPrefillResolver } from '~/components/money/ui/line-builder/line-rows'
import type { LinePatch } from '~/components/money/ui/line-builder/line-values'
import { useResourceProperty } from '~/components/resources'

interface IntakeCreatePartDialogProps {
  line: IntakeLine
  open: boolean
  onOpenChange: (open: boolean) => void
  resolvePartPrefill?: PartPrefillResolver
  onPatch: (lineId: string, patch: LinePatch) => void
}

/**
 * The part form, seeded from the vendor's printed line.
 *
 * The caller mounts it lazily, on the row's first open: mounting it up front is
 * one part form per row on a forty-row quote, each holding its own field lookups
 * and its own create mutation.
 */
export function IntakeCreatePartDialog({
  line,
  open,
  onOpenChange,
  resolvePartPrefill,
  onPatch,
}: IntakeCreatePartDialogProps) {
  const partDefId = useResourceProperty('part', 'id')

  const prefill = useMemo<PartFormPrefill>(
    () => ({
      // What the vendor called it is the best name we have for a part nobody has
      // named yet. It is a starting point in an editable field, not a decision.
      title: line.printed.description ?? line.description ?? '',
      // ⚠️ A SUGGESTION, never a value. `part_sku` is OUR number; this is the
      // vendor's, and the two coincide only sometimes. `PartFormDialog` renders
      // it under an EMPTY, required SKU field with a one-click adopt, so nothing
      // becomes our SKU without somebody looking at it. The vendor's own code
      // has its own home — the §5.3 `vendorSku` write-back at commit.
      skuSuggestion: line.printed.vendorCode ?? '',
    }),
    [line.printed.description, line.printed.vendorCode, line.description]
  )

  const handleSuccess = useCallback(
    (instanceId?: string) => {
      // Absent on edit, which this dialog never is. Nothing to link without it.
      if (!instanceId || !partDefId) return
      const partRecordId = toRecordId(partDefId, instanceId)

      // The same two writes, in the same order, as picking an existing part: the
      // link first so the row resolves and the commit gate re-counts
      // immediately, then the supplier prefill if the person filled in the
      // dialog's Supplier section for this vendor.
      //
      // 🛑 The TIER is not touched. The row stays `fuzzy`/`none` because that is
      // what the ladder actually found; stamping it `sku` would claim the
      // catalogue matched a part that did not exist a moment ago.
      onPatch(line.lineId, { partRecordId })
      void applyNewPartPrefill({
        partRecordId,
        currentPriceCents: line.unitPriceCents,
        resolve: resolvePartPrefill,
        apply: (patch) => onPatch(line.lineId, patch),
      })
    },
    [partDefId, line.lineId, line.unitPriceCents, onPatch, resolvePartPrefill]
  )

  return (
    <PartFormDialog
      open={open}
      onOpenChange={onOpenChange}
      prefill={prefill}
      onSuccess={handleSuccess}
    />
  )
}

/**
 * Stamp the supplier link onto the line, mirroring `applyPartPrefill` in
 * `line-rows.tsx` — the part picker's own post-pick step.
 *
 * The link is provenance and is written whenever the lookup returned anything.
 * The price is written only into an EMPTY cell: the vendor's printed price
 * always wins, which on a quote it almost always is.
 */
async function applyNewPartPrefill({
  partRecordId,
  currentPriceCents,
  resolve,
  apply,
}: {
  partRecordId: RecordId
  currentPriceCents: number | null
  resolve: PartPrefillResolver | undefined
  apply: (patch: LinePatch) => void
}): Promise<void> {
  if (!resolve) return
  // `null` is "the lookup could not run" — no vendor on the draft, a failed
  // request. Writing a cleared link on that erases provenance nobody erased.
  const prefill = await resolve(partRecordId)
  if (!prefill) return
  const patch: LinePatch = { vendorPartRecordId: prefill.vendorPartRecordId }
  if (prefill.unitPriceCents !== null && currentPriceCents === null) {
    patch.unitPriceCents = prefill.unitPriceCents
  }
  apply(patch)
}
