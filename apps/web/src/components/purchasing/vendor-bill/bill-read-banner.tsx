// apps/web/src/components/purchasing/vendor-bill/bill-read-banner.tsx
'use client'

import { proposalSummary } from '@auxx/lib/accounting/purchasing/bill-intake/client'
import type { RecordId } from '@auxx/types/resource'
import { formatDistanceToNow } from 'date-fns'
import { AlertTriangle, ChevronRight, ScanSearch } from 'lucide-react'
import { api } from '~/trpc/react'
import { useVendorBillLines } from './use-vendor-bill-lines'

/** Summarize the invoice read and outstanding bill-line review. */
export function BillReadBanner({ billRecordId }: { billRecordId: RecordId }) {
  const { data: run } = api.purchasing.getBillIntakeRunForBill.useQuery(
    { billRecordId },
    { staleTime: 60_000 }
  )
  const { rows, ready } = useVendorBillLines(billRecordId)
  if (!run) return null

  const initialSummary = run.proposals ? proposalSummary(run.proposals) : null
  const summary =
    ready && initialSummary
      ? {
          total: rows.length,
          linked: rows.filter((row) => !!row.values.purchaseOrderLineRecordId).length,
          needsPerson: rows.filter(
            (row) => !row.values.purchaseOrderLineRecordId && !row.values.glAccount
          ).length,
        }
      : initialSummary
  const statusText = summary
    ? `${summary.linked} of ${summary.total} lines linked · ${summary.needsPerson} to review`
    : 'Ready for review'

  return (
    <div className='min-w-0 border-b px-3 py-2 text-xs text-muted-foreground [overflow-wrap:anywhere]'>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
        <span className='inline-flex items-center gap-1.5'>
          <ScanSearch className='size-3.5' />
          Read {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
        </span>
        <span>{statusText}</span>
        {run.warnings.length > 0 && (
          <details className='group basis-full'>
            <summary className='flex w-fit cursor-pointer list-none items-center gap-1.5 py-1 [&::-webkit-details-marker]:hidden'>
              <ChevronRight className='size-3 transition-transform group-open:rotate-90' />
              <AlertTriangle className='size-3.5 text-amber-600 dark:text-amber-400' />
              {run.warnings.length} {run.warnings.length === 1 ? 'warning' : 'warnings'}
            </summary>
            <ul className='space-y-1 pb-1 pl-5'>
              {run.warnings.map((warning) => (
                <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}
