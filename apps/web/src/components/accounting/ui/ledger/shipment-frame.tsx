// apps/web/src/components/accounting/ui/ledger/shipment-frame.tsx

'use client'

import type { CloseBlockerItem, PostingStatus } from '@auxx/lib/accounting/ledger/client'
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
  Clock,
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
import { EntryBlockers } from './entry-blockers'
import { formatAccountingDate, formatAuditTimestamp, formatMinor } from './format'
import type { FrameHeader } from './posting-frame'
import { postingTypeLabel } from './type-labels'

const STATUS_VARIANT: Record<PostingStatus, Variant> = {
  draft: 'outline',
  posted: 'green',
  reversed: 'amber',
}

const STATUS_LABEL: Record<PostingStatus, string> = {
  draft: 'Draft',
  posted: 'Posted',
  reversed: 'Reversed',
}

/** The roles an `account_unmapped` refusal names, parsed the way `movement-frame.tsx` parses them. */
function unmappedRoleItems(reason: string): CloseBlockerItem[] {
  const items: CloseBlockerItem[] = []
  for (const match of reason.matchAll(/'([a-z0-9_]+)'\s*(\([^)]*\))?([^']*)/g)) {
    const role = match[1]
    if (!role || items.some((item) => item.ref === role)) continue
    items.push({
      key: 'unmapped_role',
      label: match[2] ? `${role} ${match[2]}` : role,
      remedy: match[3]?.trim() || 'It is not mapped to any account.',
      ref: role,
    })
  }
  return items
}

/**
 * The shipment frame's identity strip and its Retry, read by the host: one
 * `DrawerHeader` serves the whole stack (83 §2.4).
 */
export function useShipmentFrameHeader(
  fulfillmentId: string | null,
  { onOpenPosting }: { onOpenPosting: (glPostingId: string) => void }
): FrameHeader {
  const utils = api.useUtils()
  const { data: detail } = api.ledger.getBlockedFulfillment.useQuery(
    { fulfillmentId: fulfillmentId ?? '' },
    { enabled: !!fulfillmentId }
  )

  const retry = api.ledger.retryBlockedFulfillment.useMutation({
    onSuccess: (result) => {
      void utils.ledger.listBlocked.invalidate()
      void utils.ledger.listDrafts.invalidate()
      void utils.ledger.listPostings.invalidate()
      void utils.ledger.outboxCounts.invalidate()
      if (result.status === 'accepted' || result.status === 'drafted') {
        onOpenPosting(result.glPostingId)
        return
      }
      toastError({ title: 'Still not posted', description: result.reason })
      void utils.ledger.getBlockedFulfillment.invalidate()
    },
    onError: (error) => toastError({ title: 'Could not retry', description: error.message }),
  })

  return {
    drawerTitle: 'Shipment',
    icon: detail ? (
      <CircleAlert className='size-5 text-destructive' />
    ) : (
      <Truck className='size-5 text-muted-foreground' />
    ),
    title: (
      <div className='flex flex-wrap items-center gap-2'>
        <span className='font-medium'>{detail?.name ?? 'Shipment'}</span>
        {detail && (
          <Badge variant='destructive' size='sm'>
            Blocked
          </Badge>
        )}
      </div>
    ),
    actions: detail && (
      <Tooltip content='Post this shipment again'>
        <Button
          variant='ghost'
          size='icon-xs'
          aria-label='Post this shipment again'
          disabled={retry.isPending}
          onClick={() => retry.mutate({ fulfillmentId: detail.id })}>
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
 * One refused shipment - the body of a `~shipment:` frame in `LedgerDrawerHost`
 * (88 §4.5). The reason in the poster's own words with the remedy card for an
 * unmapped role, the draft or posting it produced, and the records it belongs
 * to; Retry lives on the host's header.
 */
export function ShipmentFrame({ fulfillmentId, bookTimeZone }: ShipmentFrameProps) {
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'
  const openFrame = useOpenRecord()

  const detailQuery = api.ledger.getBlockedFulfillment.useQuery({ fulfillmentId })
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
    return (
      <div className='p-4 text-muted-foreground text-sm'>
        No refused shipment matches this link.
      </div>
    )
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
          <MetricCell
            label='Refused'
            icon={<Clock className='size-4 text-muted-foreground' />}
            className='col-span-2'
            value={
              detail.blockedAt
                ? formatAuditTimestamp(detail.blockedAt.toISOString(), bookTimeZone)
                : '—'
            }
          />
        </MetricGrid>

        <Section
          title='Why it was refused'
          icon={<CircleAlert className='size-4' />}
          description='In the ledger’s own words. Retry once the cause is fixed.'
          collapsible={false}>
          {detail.reasonKind === 'account_unmapped' ? (
            <EntryBlockers
              blockers={[
                {
                  status: 'account_unmapped',
                  error: detail.reason,
                  items: unmappedRoleItems(detail.reason),
                },
              ]}
            />
          ) : (
            <p className='text-sm'>{detail.reason}</p>
          )}
        </Section>

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
