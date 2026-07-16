// apps/web/src/components/money/ui/invoice/invoice-billing-context-card.tsx
'use client'

import { extractRelationshipRecordIds } from '@auxx/lib/field-values/client'
import { Button } from '@auxx/ui/components/button'
import { ArrowRight, CalendarDays, Wrench } from 'lucide-react'
import type { DrawerTabProps } from '~/components/drawers/drawer-tab-registry'
import { useOpenRecord } from '~/components/records/record-drill-panels'
import { useSystemValues } from '~/components/resources/hooks/use-system-values'

const ATTRS = [
  'invoice_billing_kind',
  'invoice_work_order',
  'invoice_installment_name',
  'invoice_progress_percent',
  'invoice_service_period_start',
  'invoice_service_period_end',
  'invoice_visit_count',
] as const

/** Read-only provenance context for an invoice snapshot. */
export function InvoiceBillingContextCard({ recordId }: DrawerTabProps) {
  const { values, isLoading } = useSystemValues(recordId, [...ATTRS], { autoFetch: true })
  const openRecord = useOpenRecord()
  if (isLoading) return <div className='h-14 animate-pulse rounded-xl bg-muted' />
  const kind = String(values.invoice_billing_kind ?? 'standalone')
  const workOrderId = extractRelationshipRecordIds(values.invoice_work_order)[0]
  if (kind === 'standalone')
    return <p className='text-sm text-muted-foreground'>Standalone invoice</p>
  const installmentValue = unwrap(values.invoice_installment_name)
  const installment = installmentValue == null ? null : String(installmentValue)
  const progress = Number(unwrap(values.invoice_progress_percent) ?? 0)
  const startValue = unwrap(values.invoice_service_period_start)
  const endValue = unwrap(values.invoice_service_period_end)
  const start = startValue == null ? null : String(startValue)
  const end = endValue == null ? null : String(endValue)
  const visits = Number(unwrap(values.invoice_visit_count) ?? 0)
  return (
    <div className='space-y-2'>
      <div className='rounded-xl border bg-primary-100 p-3 text-sm'>
        <div className='font-medium capitalize'>{kind.replaceAll('_', ' ')}</div>
        {installment && <div className='mt-1 text-xs text-muted-foreground'>{installment}</div>}
        {progress > 0 && (
          <div className='mt-1 text-xs text-muted-foreground'>{progress}% of contract</div>
        )}
        {(start || end || visits > 0) && (
          <div className='mt-2 flex items-center gap-1.5 text-xs text-muted-foreground'>
            <CalendarDays className='size-3.5' />
            {visits > 0 && `${visits} visit${visits === 1 ? '' : 's'}`}
            {start && ` · ${formatDate(start)}`}
            {end && end !== start && ` – ${formatDate(end)}`}
          </div>
        )}
      </div>
      {workOrderId && (
        <Button
          variant='ghost'
          size='sm'
          className='w-full justify-between'
          onClick={() => openRecord?.(workOrderId)}>
          <span className='flex items-center gap-2'>
            <Wrench /> Source work order
          </span>
          <ArrowRight />
        </Button>
      )}
    </div>
  )
}

function unwrap(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}
