// apps/web/src/components/accounting/ui/ledger/sidebar/books-group.tsx

'use client'

import type { BooksBalanceReport, DuplicateMovementFinding } from '@auxx/lib/postings/client'
import { SidebarGroup, SidebarGroupLabel } from '@auxx/ui/components/sidebar'
import { BooksBalanceLine, DuplicateMovementsCard, hasBooksFindings } from '../books-health'

interface BooksGroupProps {
  report: BooksBalanceReport | undefined
  /** The sweep's own failure message, or `null`. */
  error: string | null
  duplicates: DuplicateMovementFinding[] | undefined
  currencyCode: string
  bookTimeZone: string
}

/**
 * What the balance sweep FOUND. Renders nothing at all when it found nothing.
 *
 * 🛑 The standing answer - "0 discrepancies out of 46 postings checked" - is on
 * the stats strip, not here. A rail group whose whole content is a number that
 * reads the same every day teaches people to stop looking at the rail. This one
 * appears only when there is an entry that does not tie, a month that is short,
 * a duplicate movement, or nothing posted at all to have checked.
 *
 * 🛑 A failed sweep and a running one are not the same state. The failure gets a
 * group of its own; a sweep still in flight renders nothing, because the stats
 * strip already says it has not answered and a skeleton here would flash into a
 * group that is about to disappear.
 *
 * ⚠️ `py-2` + `h-8` is `/app/settings`' group spacing - see
 * `close-month-group.tsx` for why `SidebarGroup` gives none on its own.
 */
export function BooksGroup({
  report,
  error,
  duplicates,
  currencyCode,
  bookTimeZone,
}: BooksGroupProps) {
  if (error) {
    return (
      <SidebarGroup className='py-2'>
        <SidebarGroupLabel className='h-8'>Books</SidebarGroupLabel>
        <p className='px-2 pb-1 text-xs text-destructive'>
          The balance sweep could not run, so nothing here has been checked. {error}
        </p>
      </SidebarGroup>
    )
  }

  const hasDuplicates = !!duplicates?.length
  if (!report || (!hasBooksFindings(report) && !hasDuplicates)) return null

  return (
    <SidebarGroup className='py-2'>
      <SidebarGroupLabel className='h-8'>Books</SidebarGroupLabel>
      <div className='flex flex-col gap-2 px-2 pb-1'>
        <BooksBalanceLine report={report} />

        {hasDuplicates && (
          <DuplicateMovementsCard
            findings={duplicates}
            currencyCode={currencyCode}
            bookTimeZone={bookTimeZone}
          />
        )}
      </div>
    </SidebarGroup>
  )
}
