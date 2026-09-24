// apps/web/src/components/accounting/ui/setup-wizard/connect-and-go-backlog.tsx
'use client'

import { isMonthKey } from '@auxx/lib/accounting/ledger/client'
import { Section } from '@auxx/ui/components/section'
import { type StatCardData, StatCards } from '@auxx/ui/components/stat-card'
import { cn } from '@auxx/ui/lib/utils'
import { pluralize } from '@auxx/utils'
import { formatDistanceStrict } from 'date-fns'
import { Clock, Package, Send, Wallet, Waypoints } from 'lucide-react'
import { api } from '~/trpc/react'

/** What the catch-up after this cutover will post and export, and roughly how long it takes. */
export function ConnectAndGoBacklog({
  cutoffPeriod,
  bookTimeZone,
  exportMode,
  providerLabel,
}: {
  cutoffPeriod: string
  bookTimeZone: string | null
  exportMode: 'transaction' | 'summary'
  providerLabel: string
}) {
  const valid = isMonthKey(cutoffPeriod)
  const preview = api.ledger.connectAndGo.preview.useQuery(
    { cutoffPeriod, bookTimeZone, exportMode },
    { enabled: valid }
  )
  if (!valid) return null
  const data = preview.data

  const cards: StatCardData[] = [
    {
      title: 'Shipments',
      body: (data?.shipments ?? 0).toLocaleString(),
      icon: <Package />,
      description: 'Posted after the cutover',
    },
    {
      title: 'Money movements',
      body: (data?.movements ?? 0).toLocaleString(),
      icon: <Wallet />,
      description: data?.importedPayments
        ? `+ ${data.importedPayments.toLocaleString()} imported ${pluralize(data.importedPayments, 'payment')}`
        : 'Payments, refunds, payouts',
    },
    {
      title: `Exports to ${providerLabel}`,
      body: `~${(data?.estimatedExports ?? 0).toLocaleString()}`,
      icon: <Send />,
      description: data?.exportMode === 'summary' ? 'Summary mode' : 'One per document',
    },
    {
      title: 'Time to catch up',
      // The recovery job takes 100 per kind every minute.
      body: data?.drainMinutes ? formatDistanceStrict(0, data.drainMinutes * 60_000) : 'None',
      icon: <Clock />,
      description: '100 per kind every minute',
    },
  ]

  return (
    <Section
      title='After the cutover'
      className='[&_[data-slot=section]]:border-b-0'
      description='What posts and exports once you finish.'
      icon={<Waypoints className='size-4 text-muted-foreground' />}
      collapsible={false}>
      <div className='flex flex-col gap-2'>
        <StatCards
          // One row of four draws only side borders; in two rows of two the second row needs a
          // top border and its first card no left one.
          cards={cards.map((card, index) => ({
            ...card,
            className: cn(index === 2 && 'md:border-l-0', index >= 2 && 'md:border-t'),
          }))}
          loading={preview.isLoading}
          columns={{ md: 'md:grid-cols-2' }}
          className='rounded-lg border md:overflow-hidden'
        />
        {preview.isError && (
          <p className='text-muted-foreground text-xs'>{preview.error.message}</p>
        )}
        {!!data?.relief && (
          <p className='text-muted-foreground text-xs'>
            {data.relief.toLocaleString()} {pluralize(data.relief, 'shipment')} also waiting on
            stock relief.
          </p>
        )}
      </div>
    </Section>
  )
}
