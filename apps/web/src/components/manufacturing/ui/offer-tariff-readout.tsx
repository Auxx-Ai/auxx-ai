// apps/web/src/components/manufacturing/ui/offer-tariff-readout.tsx
'use client'

// The Duty row (plans/money/tasks/30-tariff-offer-surfaces.md §3.2): what one
// supplier offer's rate resolves to, and where it came from.
//
// 🛑 Five readings and only one of them is a bare percentage. `none`,
// `unclassified` and `pending` all carry 0 and mean three different things -
// never classified; classified but the code has no rows; classified and every
// row starts in the future. A row that prints `0%` for all three tells a person
// with an unfinished offer that they are done.
//
// 🛑 The both-set case is LOUD. Under 29 §3.1 a set override beats the schedule
// silently, so an offer classified last month with a 25% typed last year shows
// 25% forever while the schedule says 47%. This is the row the person is
// looking at when that happens, so it says so here as well as on the
// Classification tab's Override badge.

import type { OfferTariff } from '@auxx/lib/bom/client'
import { TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { formatPercent } from '../hooks/use-offer-tariffs'
import { authorityLabel, formatEffectiveFrom } from '../tariff-types'

interface OfferTariffReadoutProps {
  /** The offer's resolved rate, override included. */
  tariff: OfferTariff
  /** What the schedule alone says. Only read when {@link tariff} is an override. */
  scheduleTariff?: OfferTariff
  /** `8481.80.9005 CN`, when the offer carries a code. */
  codeLabel?: string
  /** The viewer cannot read the schedule (`useOfferTariffs().unavailable`). */
  unavailable?: boolean
}

const TARIFFS_HREF = '/app/parts/settings/tariffs'

/** One line, plus the per-authority components when the schedule produced the number. */
export function OfferTariffReadout({
  tariff,
  scheduleTariff,
  codeLabel,
  unavailable,
}: OfferTariffReadoutProps) {
  if (tariff.source === 'override') {
    const scheduleSays =
      scheduleTariff?.source === 'schedule' && scheduleTariff.status === 'resolved'
        ? scheduleTariff.rate
        : null
    return (
      <div className='flex min-h-8 flex-col justify-center gap-0.5 text-sm'>
        <span className='tabular-nums'>
          {formatPercent(tariff.rate)} <span className='text-muted-foreground'>(override)</span>
        </span>
        {scheduleSays != null && scheduleSays !== tariff.rate && (
          <span className='flex items-center gap-1 text-amber-700 text-xs dark:text-amber-400'>
            <TriangleAlert className='size-3.5 shrink-0' />
            Schedule says {formatPercent(scheduleSays)} - the override wins. Clear it to use the
            schedule.
          </span>
        )}
      </div>
    )
  }

  if (tariff.source === 'none') {
    return (
      <div className='flex min-h-8 items-center text-muted-foreground text-sm'>
        No duty - no code and no override
      </div>
    )
  }

  if (unavailable) {
    return (
      <div className='flex min-h-8 items-center text-muted-foreground text-sm'>
        Schedule not readable - the rate is resolved on the server
      </div>
    )
  }

  if (tariff.status === 'unclassified') {
    return (
      <div className='flex min-h-8 flex-col justify-center text-sm'>
        <span>No rate rows on {codeLabel ?? 'this code'}</span>
        <Link
          href={TARIFFS_HREF}
          className='text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground'>
          Add the rates in Parts &rsaquo; Settings &rsaquo; Tariffs
        </Link>
      </div>
    )
  }

  if (tariff.status === 'pending') {
    return (
      <div className='flex min-h-8 items-center text-muted-foreground text-sm'>
        Starts later - nothing on {codeLabel ?? 'this code'} is in force today
      </div>
    )
  }

  return (
    <div className='flex min-h-8 flex-col justify-center gap-0.5 text-sm'>
      <span className='tabular-nums'>
        {formatPercent(tariff.rate)}
        {codeLabel && <span className='text-muted-foreground'> ({codeLabel})</span>}
      </span>
      <span className='text-muted-foreground text-xs tabular-nums'>
        {tariff.components
          .map(
            (component) =>
              `${authorityLabel(component.authority)} ${formatPercent(component.rate)} from ${formatEffectiveFrom(component.effectiveFrom)}`
          )
          .join(' + ')}
      </span>
    </div>
  )
}
