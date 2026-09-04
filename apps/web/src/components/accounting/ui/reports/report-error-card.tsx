// apps/web/src/components/accounting/ui/reports/report-error-card.tsx

'use client'

import { TriangleAlert } from 'lucide-react'

/**
 * A report's read failed (`plans/accounting/HANDOFF.md` slot 1E, rule 5):
 * `entry-blockers.tsx`'s `failure` tone, without its `PostResultStatus`
 * remedy table - a statement read has no named refusals, only the server's
 * own `AuxxError` message. Never a toast: the failure IS the page's content
 * until it is fixed, the same reasoning `EntryBlockers` gives for the ledger.
 */
export function ReportErrorCard({ message }: { message: string }) {
  return (
    <div className='flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4'>
      <TriangleAlert className='mt-0.5 size-5 shrink-0 text-destructive' />
      <div className='flex flex-col gap-1'>
        <span className='font-medium'>This report could not be built</span>
        <p className='text-sm'>{message}</p>
      </div>
    </div>
  )
}
