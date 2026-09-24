// apps/web/src/components/accounting/ui/setup-wizard/connect-and-go-backlog.tsx
'use client'

import { isMonthKey } from '@auxx/lib/accounting/connect-and-go/client'
import { api } from '~/trpc/react'

/** What the catch-up after this cutover will post and export, and roughly how long it takes. */
export function ConnectAndGoBacklog({
  cutoffPeriod,
  bookTimeZone,
  providerLabel,
}: {
  cutoffPeriod: string
  bookTimeZone: string | null
  providerLabel: string
}) {
  const valid = isMonthKey(cutoffPeriod)
  const preview = api.ledger.connectAndGo.preview.useQuery(
    { cutoffPeriod, bookTimeZone },
    { enabled: valid }
  )

  if (!valid) return null
  const data = preview.data
  if (!data) {
    return (
      <p className='text-muted-foreground text-xs'>
        {preview.isError ? preview.error.message : 'Counting what comes after the cutover…'}
      </p>
    )
  }

  const nothing = data.shipments + data.movements + data.relief + data.importedPayments === 0
  return (
    <div className='flex flex-col gap-1 rounded-lg border p-3 text-sm'>
      <span className='font-medium'>After the cutover</span>
      {nothing ? (
        <span className='text-muted-foreground text-xs'>
          Nothing dated after {cutoffPeriod} is waiting to post.
        </span>
      ) : (
        <>
          <span className='text-muted-foreground text-xs'>
            {count(data.shipments, 'shipment')}, {count(data.movements, 'money movement')}
            {data.importedPayments > 0
              ? `, ${count(data.importedPayments, 'imported payment')}`
              : ''}
            {data.relief > 0
              ? ` and ${count(data.relief, 'shipment')} waiting on stock relief`
              : ''}{' '}
            will post once you finish.
          </span>
          <span className='text-muted-foreground text-xs'>
            About {count(data.estimatedExports, 'object')} go to {providerLabel} (
            {data.exportMode === 'summary' ? 'summary mode' : 'one per document'}). The catch-up
            takes 100 per kind every minute, so it is done in about {duration(data.drainMinutes)}.
          </span>
        </>
      )}
    </div>
  )
}

function count(n: number, noun: string): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`
}

function duration(minutes: number): string {
  if (minutes < 60) return count(Math.max(minutes, 1), 'minute')
  const hours = Math.round((minutes / 60) * 2) / 2
  const whole = Math.floor(hours)
  const text = hours === whole ? `${whole}` : whole === 0 ? '½' : `${whole}½`
  return `${text} hour${hours === 1 ? '' : 's'}`
}
