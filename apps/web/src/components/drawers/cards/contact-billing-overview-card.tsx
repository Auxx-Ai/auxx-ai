// apps/web/src/components/drawers/cards/contact-billing-overview-card.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { ArrowRight, ReceiptText } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { normalizeContactBilling } from '~/components/money/billing/types'
import { formatCurrency } from '~/components/money/ui/line-builder/shared'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'
import { api } from '~/trpc/react'
import type { DrawerTabProps } from '../drawer-tab-registry'

/** Allocation-backed customer billing summary shared by the contact drawer and detail sidebar. */
export function ContactBillingOverviewCard({ recordId }: DrawerTabProps) {
  const utils = api.useUtils()
  const query = api.money.getContactBillingOverview.useQuery({ contactRecordId: recordId })
  const { values } = useSystemValues(recordId, ['contact_billing_revision'], { autoFetch: true })
  const revision = values.contact_billing_revision
  const previousRevision = useRef(revision)
  useEffect(() => {
    if (previousRevision.current === undefined) {
      previousRevision.current = revision
      return
    }
    if (revision !== previousRevision.current) {
      previousRevision.current = revision
      void utils.money.getContactBillingOverview.invalidate({ contactRecordId: recordId })
    }
  }, [recordId, revision, utils])
  const billing = useMemo(() => normalizeContactBilling(query.data), [query.data])
  const openRecord = useOpenRecord()

  if (query.isLoading) return <Skeleton className='h-24 w-full rounded-xl' />
  const empty =
    billing.balanceDue === 0 &&
    billing.uninvoicedAmount === 0 &&
    billing.draftCount === 0 &&
    billing.recentInvoices.length === 0
  if (empty)
    return (
      <p className='rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground'>
        No billing activity yet.
      </p>
    )

  return (
    <div className='space-y-2'>
      <div className='grid grid-cols-3 gap-2 rounded-xl border bg-primary-100 p-3'>
        <Summary label='Balance due' value={billing.balanceDue} currency={billing.currencyCode} />
        <Summary
          label='Overdue'
          value={billing.overdueAmount}
          currency={billing.currencyCode}
          suffix={billing.overdueCount ? `${billing.overdueCount}` : undefined}
        />
        <Summary
          label='Uninvoiced work'
          value={billing.uninvoicedAmount}
          currency={billing.currencyCode}
        />
      </div>
      {billing.draftCount > 0 && (
        <div className='flex justify-between px-2 text-xs text-muted-foreground'>
          <span>
            {billing.draftCount} draft invoice{billing.draftCount === 1 ? '' : 's'}
          </span>
          <span>{formatCurrency(billing.draftAmount, billing.currencyCode)}</span>
        </div>
      )}
      {billing.readyWorkOrderCount > 0 && (
        <Button
          variant='ghost'
          size='sm'
          className='w-full justify-between'
          onClick={() =>
            billing.readyWorkOrderRecordId && openRecord?.(billing.readyWorkOrderRecordId)
          }>
          {billing.readyWorkOrderCount} work order{billing.readyWorkOrderCount === 1 ? '' : 's'}{' '}
          ready to invoice <ArrowRight />
        </Button>
      )}
      <div className='divide-y rounded-xl border'>
        {billing.recentInvoices.map((invoice) => (
          <button
            type='button'
            key={invoice.recordId}
            onClick={() => openRecord?.(invoice.recordId)}
            className='flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-primary-100'>
            <ReceiptText className='size-4 text-muted-foreground' />
            <span className='min-w-0 flex-1 truncate text-sm'>{invoice.displayName}</span>
            <span className='text-xs text-muted-foreground'>{invoice.status}</span>
            <span className='text-sm tabular-nums'>
              {formatCurrency(invoice.total, billing.currencyCode)}
            </span>
            <span className='text-xs tabular-nums text-muted-foreground'>
              {formatCurrency(invoice.balance, billing.currencyCode)} due
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Summary({
  label,
  value,
  currency,
  suffix,
}: {
  label: string
  value: number
  currency: string
  suffix?: string
}) {
  return (
    <div className='min-w-0'>
      <span className='block truncate text-[11px] text-muted-foreground'>{label}</span>
      <span className='block truncate text-sm font-medium tabular-nums'>
        {formatCurrency(value, currency)}
      </span>
      {suffix && <span className='text-[10px] text-muted-foreground'>{suffix} overdue</span>}
    </div>
  )
}
