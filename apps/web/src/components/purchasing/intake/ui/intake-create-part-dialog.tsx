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
import { parseRecordId, type RecordId, toRecordId } from '@auxx/lib/resources/client'
import { useCallback, useMemo } from 'react'
import {
  PartFormDialog,
  type PartFormPrefill,
} from '~/components/manufacturing/parts/part-form-dialog'
import {
  applyPartPrefill,
  type PartPrefillResolver,
} from '~/components/money/ui/line-builder/line-rows'
import type { LinePatch } from '~/components/money/ui/line-builder/line-values'
import { useResourceProperty } from '~/components/resources'

interface IntakeCreatePartDialogProps {
  line: IntakeLine
  /** The quote's vendor. Seeds the form's Supplier section; `null` leaves it shut. */
  vendorRecordId: RecordId | null
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
  vendorRecordId,
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
      // has its own home — the Supplier section below, and the §5.3 write-back.
      skuSuggestion: line.printed.vendorCode ?? '',
      // ✅ Everything this section needs is already on screen: the vendor is the
      // quote's vendor, the code and the price are the line the person is
      // looking at. Retyping them into a collapsed panel is the step this
      // removes — and creating the `vendor_part` HERE is strictly better than
      // teaching it at commit, because a part created from a quote has no
      // catalogue entry for this supplier by definition, so the §5.3 write-back
      // would create one anyway, one screen later, with less context.
      //
      // 🛑 `unitPrice` is the printed price, not the chosen break. A break is a
      // property of THIS order's quantity; the catalogue entry's price is the
      // vendor's list price for one purchase unit.
      supplier: vendorRecordId
        ? {
            companyInstanceId: parseRecordId(vendorRecordId).entityInstanceId,
            vendorSku: line.printed.vendorCode,
            unitPrice: line.unitPriceCents,
            purchaseUnit: line.printed.unit,
          }
        : undefined,
    }),
    [
      line.printed.description,
      line.printed.vendorCode,
      line.printed.unit,
      line.description,
      line.unitPriceCents,
      vendorRecordId,
    ]
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
      void applyPartPrefill({
        partRecordId,
        resolve: resolvePartPrefill,
        // A plain box, not `useLatestRef`: this fires once from a dialog that is
        // about to unmount, so there is no later edit for the ref to track.
        currentPriceRef: { current: line.unitPriceCents },
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
