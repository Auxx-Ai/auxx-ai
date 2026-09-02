// apps/web/src/components/purchasing/intake/ui/intake-tier-badge.tsx
'use client'

// How a printed line code was matched to one of our parts, said twice: once as a
// scan marker and once as a word (plans/money/tasks/38 §5.2 / §6.2).
//
// ⚠️ `vendor_sku` and `sku` are BOTH exact, and they must not read alike. Tier 2
// is vendor-blind by construction — two vendors can print our SKU for different
// goods — so it is a weaker answer than a hit in this vendor's own catalogue,
// and the tooltip says which of the two happened rather than leaving the colour
// to carry it.

import { INTAKE_TIER_LABELS, type IntakeTier } from '@auxx/lib/purchasing/intake/client'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { cn } from '@auxx/ui/lib/utils'

const TIER_VARIANT: Record<IntakeTier, Variant> = {
  vendor_sku: 'green',
  sku: 'blue',
  fuzzy: 'amber',
  none: 'red',
}

const TIER_DOT: Record<IntakeTier, string> = {
  vendor_sku: 'bg-green-500',
  sku: 'bg-blue-500',
  fuzzy: 'bg-amber-500',
  none: 'bg-red-500',
}

/** Why this row matched the way it did. Written for the person, not the ladder. */
export function tierReason(tier: IntakeTier, vendorName: string | null): string {
  const vendor = vendorName ?? 'this vendor'
  switch (tier) {
    case 'vendor_sku':
      return `${vendor}'s catalogue lists this code against this part.`
    case 'sku':
      return `Our own SKU matched the printed code. ${vendor} has no catalogue entry for it, so nothing confirms the code means the same goods.`
    case 'fuzzy':
      return 'Only the wording matched. Nothing links this code to a part yet; pick one.'
    case 'none':
      return 'Nothing matched this line. Pick a part, create one, or fold the amount into shipping or tax.'
  }
}

/**
 * The full badge — a word, in the printed sub-row where there is room for one.
 */
export function IntakeTierBadge({
  tier,
  vendorName,
}: {
  tier: IntakeTier
  vendorName: string | null
}) {
  return (
    <SimpleTooltip content={tierReason(tier, vendorName)}>
      <Badge variant={TIER_VARIANT[tier]} size='sm'>
        {INTAKE_TIER_LABELS[tier]}
      </Badge>
    </SimpleTooltip>
  )
}

/**
 * The scan marker, for the row's left gutter.
 *
 * 🛑 A dot rather than the word, because the slot it rides in is `DraftLineRow`'s
 * grip gutter and it is gutter-width. The word is not dropped, it moves to the
 * printed sub-row directly beneath — a colour alone would make `Vendor SKU` and
 * `Our SKU` two shades of the same claim, which is exactly what §5.2 forbids.
 */
export function IntakeTierDot({
  tier,
  vendorName,
}: {
  tier: IntakeTier
  vendorName: string | null
}) {
  return (
    <span className='-left-2.5 -translate-y-1/2 absolute top-1/2 z-10 flex h-5 w-5 items-center justify-center'>
      <SimpleTooltip content={`${INTAKE_TIER_LABELS[tier]} — ${tierReason(tier, vendorName)}`}>
        <span className={cn('size-2 rounded-full ring-2 ring-background', TIER_DOT[tier])} />
      </SimpleTooltip>
    </span>
  )
}
