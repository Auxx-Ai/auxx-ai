// apps/web/src/components/accounting/ui/reports/report-error-card.tsx

'use client'

import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
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
    <Alert variant='destructive'>
      <TriangleAlert />
      <AlertTitle>This report could not be built</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
