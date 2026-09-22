// apps/web/src/components/accounting/ui/ledger/shipment-frame.tsx

'use client'

import type { PostingStatus } from '@auxx/lib/accounting/ledger/client'
import { toRecordId } from '@auxx/lib/resources/client'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { MetricCell, MetricGrid } from '@auxx/ui/components/metric-grid'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import {
  BookOpenCheck,
  CalendarClock,
  CircleAlert,
  Coins,
  Link2,
  RefreshCw,
  Truck,
} from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { toFrame, useOpenRecord } from '~/components/records/record-drill-panels'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { formatAccountingDate, formatMinor } from './format'
import type { FrameHeader } from './posting-frame'
import { postingTypeLabel } from './type-labels'
import { WorkItemsSection } from './work-items-section'

const STATUS_VARIANT: Record<PostingStatus, Variant> = {
  posted: 'green',
  reversed: 'amber',
}

const STATUS_LABEL: Record<PostingStatus, string> = {
  posted: 'Posted',
  reversed: 'Reversed',
}

/**
 * The shipment frame's identity strip and its Retry, read by the host: one
 * `DrawerHeader` serves the whole stack (83 §2.4).
 */
export function useShipmentFrameHeader(fulfillmentId: string | null): FrameHeader {
  const utils = api.useUtils()
  const { data: detail } = api.ledger.getShipment.useQuery(
    { fulfillmentId: fulfillmentId ?? '' },
    { enabled: !!fulfillmentId }
  )
  const isBlocked = (detail?.workItems.length ?? 0) > 0

  // Retry makes its rows due now; the recovery job posts it within a minute.
  const retry = api.ledger.retryBlockedGroup.useMutation({
    onSuccess: () => {
      void utils.ledger.listBlocked.invalidate()
      void utils.ledger.listBlockedItems.invalidate()
      void utils.ledger.getShipment.invalidate()
    },
    onError: (error) => toastError({ title: 'Could not retry', description: error.message }),
  })

  return {
    drawerTitle: 'Shipment',
    icon: isBlocked ? (
      <CircleAlert className='size-5 text-destructive' />
    ) : (
      <Truck className='size-5 text-muted-foreground' />
    ),
    title: (
      <div className='flex flex-wrap items-center gap-2'>
        <span className='font-medium'>{detail?.name ?? 'Shipment'}</span>
        {isBlocked && (
          <Badge variant='destructive' size='sm'>
            Blocked
          </Badge>
        )}
      </div>
    ),
    actions: isBlocked && detail && (
      <Tooltip content='Post this shipment again'>
        <Button
          variant='ghost'
          size='icon-xs'
          aria-label='Post this shipment again'
          disabled={retry.isPending}
          onClick={() =>
            retry.mutate({ source: { sourceKind: 'fulfillment', sourceId: detail.id } })
          }>
          <RefreshCw className={retry.isPending ? 'animate-spin' : undefined} />
        </Button>
      </Tooltip>
    ),
  }
}

interface ShipmentFrameProps {
  /** From `?shipment=<id>` or a `~shipment:` peek frame. */
  fulfillmentId: string
  bookTimeZone: string
}

/**
 * One shipment - the body of a `~shipment:` frame in `LedgerDrawerHost` (88 §4.5):
 * its work items while it is parked, the postings it produced, and the records it
 * belongs to. Retry lives on the host's header.
 */
export function ShipmentFrame({ fulfillmentId, bookTimeZone }: ShipmentFrameProps) {
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'
  const openFrame = useOpenRecord()

  const detailQuery = api.ledger.getShipment.useQuery({ fulfillmentId })
  const detail = detailQuery.data ?? null

  const postingsQuery = api.ledger.listPostingsForSource.useQuery({
    sourceKind: 'fulfillment',
    sourceId: fulfillmentId,
  })
  const postings = postingsQuery.data ?? []

  if (detailQuery.isPending) {
    return (
      <div className='flex flex-col gap-2 p-4'>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-40 w-full' />
      </div>
    )
  }

  if (!detail) {
    return <div className='p-4 text-muted-foreground text-sm'>No shipment matches this link.</div>
  }

  const links = [
    { role: 'shipment', recordId: toRecordId(detail.entityDefinitionId, detail.id) },
    ...(detail.orderDefinitionId && detail.orderId
      ? [{ role: 'order', recordId: toRecordId(detail.orderDefinitionId, detail.orderId) }]
      : []),
  ]

  return (
    <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
      <div className='flex flex-col'>
        <MetricGrid columns={2}>
          <MetricCell
            label='Shipped'
            icon={<CalendarClock className='size-4 text-muted-foreground' />}
            value={detail.shippedAt ? formatAccountingDate(detail.shippedAt, bookTimeZone) : '—'}
          />
          <MetricCell
            label='Amount'
            icon={<Coins className='size-4 text-muted-foreground' />}
            value={formatMinor(detail.amountMinor, detail.currency)}
          />
        </MetricGrid>

        <WorkItemsSection items={detail.workItems} bookTimeZone={bookTimeZone} />

        {postings.length > 0 && (
          <Section
            title='Postings'
            icon={<BookOpenCheck className='size-4' />}
            description='The entries this shipment produced.'
            collapsible={false}>
            <TreeRowList
              items={postings}
              getKey={(posting) => posting.id}
              renderRow={(posting) => (
                <TreeRow
                  icon={<BookOpenCheck className='size-4' />}
                  title={<span className='truncate font-mono text-sm'>{posting.docNumber}</span>}
                  description={formatAccountingDate(posting.txnDate, bookTimeZone)}
                  secondary={
                    <span className='flex items-center gap-1.5'>
                      <Badge variant='outline' size='xs'>
                        {postingTypeLabel(posting.postingType)}
                      </Badge>
                      <Badge variant={STATUS_VARIANT[posting.status]} size='xs'>
                        {STATUS_LABEL[posting.status]}
                      </Badge>
                    </span>
                  }
                  actions={
                    <span className='font-mono text-sm tabular-nums'>
                      {formatMinor(posting.totalMinor, currencyCode)}
                    </span>
                  }
                  onToggleOpen={() => openFrame?.(toFrame('posting', posting.id))}
                />
              )}
            />
          </Section>
        )}

        <Section
          title='Links'
          icon={<Link2 className='size-4' />}
          description='The records this shipment belongs to.'
          collapsible={false}>
          <TreeRowList
            items={links}
            getKey={(link) => link.role}
            renderRow={(link) => (
              <TreeRow
                title={<RecordBadge recordId={link.recordId} size='sm' link openInStack />}
                trailing={
                  <Badge variant='outline' size='xs'>
                    {link.role}
                  </Badge>
                }
              />
            )}
          />
        </Section>
      </div>
    </ScrollArea>
  )
}
