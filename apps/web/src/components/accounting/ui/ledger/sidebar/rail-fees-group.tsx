// apps/web/src/components/accounting/ui/ledger/sidebar/rail-fees-group.tsx

'use client'

import type { RailFeeStatus } from '@auxx/lib/postings/client'
import { SidebarGroup, SidebarGroupLabel } from '@auxx/ui/components/sidebar'
import { railFeeSentence, railTradeNote } from '../format'

interface RailFeesGroupProps {
  /** Every ACTIVE rail, or `undefined` while the read is in flight. */
  rails: RailFeeStatus[] | undefined
  /** The read's own failure message, or `null`. */
  error: string | null
  /** `YYYY-MM` - the month on screen. Every sentence here is relative to it. */
  monthKey: string
  bookTimeZone: string
}

/**
 * Processor fees, as a FACT rather than an alarm
 * (plans/accounting/tasks/26-a-clearing-account-per-rail.md §6).
 *
 * ```
 * Processor fees
 *   Shopify Payments   Netted, booked with each payout.
 *   Authorize.net      Billed separately. Last fee booked Jul 14, 2026 (2 months ago).
 *   Affirm             Netted, booked with each payout.
 * ```
 *
 * 🛑 **No checkmark, no red, no "action required", and above all no refusal.**
 * §6 and §14's R4: a rail that bills quarterly would nag through two closes in
 * three, and everyone would learn to ignore the block. `prepareClose` gains
 * nothing from this - a fee that has not been billed yet is not an unclosed
 * month. The date is the whole message, and both `never` and `3 months ago` are
 * legible on their own, which is why there is no dismissal state to store and
 * no button here at all.
 *
 * 🛑 **Unlike `BooksGroup`, this renders even when there is nothing to worry
 * about.** That is the difference between a finding and a fact: the balance
 * sweep's standing answer is "0 discrepancies", which teaches people to stop
 * looking, while "Authorize.net bills separately" is a standing truth about how
 * this org's money moves, and seeing the netted rails beside it is what makes
 * the billed one's date mean something.
 *
 * ⚠️ A failed read gets a MUTED line, not a destructive one. Nothing here is a
 * claim about whether the books are right, so a red banner over a read that
 * timed out would be the alarm this block exists not to be.
 *
 * ⚠️ `py-2` + `h-8` is `/app/settings`' group spacing - see
 * `close-month-group.tsx` for why `SidebarGroup` gives none on its own.
 */
export function RailFeesGroup({ rails, error, monthKey, bookTimeZone }: RailFeesGroupProps) {
  if (error) {
    return (
      <SidebarGroup className='py-2'>
        <SidebarGroupLabel className='h-8'>Processor fees</SidebarGroupLabel>
        <p className='px-2 pb-1 text-xs text-muted-foreground'>
          The rails could not be read, so nothing is said here about processor fees. {error}
        </p>
      </SidebarGroup>
    )
  }

  // In flight, or an org with no payment rails on file. Neither has anything to
  // say, and a heading over an empty list would read as "no rails" for the
  // first case, which is a claim nobody checked.
  if (!rails?.length) return null

  return (
    <SidebarGroup className='py-2'>
      <SidebarGroupLabel className='h-8'>Processor fees</SidebarGroupLabel>
      <div className='flex flex-col gap-2 px-2 pb-1'>
        {rails.map((rail) => {
          const note = railTradeNote(rail, monthKey)
          return (
            <div key={rail.paymentGatewayId} className='flex flex-col gap-0.5'>
              <p className='text-xs font-medium'>{rail.name}</p>
              <p className='text-xs text-muted-foreground'>
                {railFeeSentence(rail, monthKey, bookTimeZone)}
              </p>
              {note && <p className='text-xs text-muted-foreground'>{note}</p>}
            </div>
          )
        })}
      </div>
    </SidebarGroup>
  )
}
