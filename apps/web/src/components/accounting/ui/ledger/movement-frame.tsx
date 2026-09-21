// apps/web/src/components/accounting/ui/ledger/movement-frame.tsx

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
} from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { toFrame, useOpenRecord } from '~/components/records/record-drill-panels'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { useSettings } from '~/hooks/use-settings'
import { api, type RouterOutputs } from '~/trpc/react'
import { EntryBlockers } from './entry-blockers'
import { formatAccountingDate, formatAuditTimestamp, formatMinor } from './format'
import type { FrameHeader } from './posting-frame'
import { MOVEMENT_PURPOSE_LABEL, postingTypeLabel } from './type-labels'

type MovementDetail = NonNullable<RouterOutputs['ledger']['getMovement']>

const LINK_ROLE_LABEL: Record<MovementDetail['links'][number]['role'] | 'party', string> = {
  party: 'party',
  cash_account: 'cash account',
  order: 'order',
  invoice: 'invoice',
  vendor_bill: 'vendor bill',
  quote: 'quote',
}

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

/**
 * The roles named in an `account_unmapped` refusal, as the remedy card's items.
 *
 * ⚠️ Parsed back out of the sentence because the reason is all the movement
 * stores - `resolve-roles.ts` writes one `'role' (Label) …` clause per offending
 * role, and widening `MoneyTransaction` to carry the list is not worth a column.
 */
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
 * The movement frame's identity strip and its Retry, read by the host: one
 * `DrawerHeader` serves the whole stack (83 §2.4).
 */
export function useMovementFrameHeader(
  movementId: string | null,
  { onOpenPosting }: { onOpenPosting: (glPostingId: string) => void }
): FrameHeader {
  const utils = api.useUtils()
  const { data: detail } = api.ledger.getMovement.useQuery(
    { moneyTransactionId: movementId ?? '' },
    { enabled: !!movementId }
  )
  const isBlocked = detail?.reason != null

  const retry = api.ledger.retryBlockedMovement.useMutation({
    onSuccess: (result) => {
      void utils.ledger.listBlockedMovements.invalidate()
      void utils.ledger.listDrafts.invalidate()
      void utils.ledger.listPostings.invalidate()
      void utils.ledger.outboxCounts.invalidate()
      if (result.status === 'accepted' || result.status === 'drafted') {
        onOpenPosting(result.glPostingId)
        return
      }
      toastError({ title: 'Still not posted', description: result.reason })
      void utils.ledger.getBlockedMovement.invalidate()
      void utils.ledger.getMovement.invalidate()
    },
    onError: (error) => toastError({ title: 'Could not retry', description: error.message }),
  })

  const label = detail ? MOVEMENT_PURPOSE_LABEL[detail.purpose] : 'Movement'

  return {
    drawerTitle: label,
    icon: isBlocked ? (
      <CircleAlert className='size-5 text-destructive' />
    ) : (
      <Coins className='size-5 text-muted-foreground' />
    ),
    title: (
      <div className='flex flex-wrap items-center gap-2'>
        <span className='font-medium'>{label}</span>
        {isBlocked && (
          <Badge variant='destructive' size='sm'>
            Blocked
          </Badge>
        )}
      </div>
    ),
    actions: isBlocked && detail && (
      <Tooltip content='Post this movement again'>
        <Button
          variant='ghost'
          size='icon-xs'
          aria-label='Post this movement again'
          disabled={retry.isPending}
          onClick={() => retry.mutate({ moneyTransactionId: detail.id })}>
          <RefreshCw className={retry.isPending ? 'animate-spin' : undefined} />
        </Button>
      </Tooltip>
    ),
  }
}

interface MovementFrameProps {
  /** From `?movement=<id>` or a `~movement:` peek frame. */
  movementId: string
  bookTimeZone: string
}

/**
 * One movement — the body of a `~movement:` frame in `LedgerDrawerHost`. The
 * records the money touched, the postings it produced, and - while it is still
 * refused - the reason in the ledger's own words and the remedy card for an
 * unmapped role (75-D1; Retry lives on the host's header).
 */
export function MovementFrame({ movementId, bookTimeZone }: MovementFrameProps) {
  const { getSetting } = useSettings({})
  const currencyCode = (getSetting('organization.currency') as string | null) ?? 'USD'
  const openFrame = useOpenRecord()

  const detailQuery = api.ledger.getMovement.useQuery({ moneyTransactionId: movementId })
  const detail = detailQuery.data ?? null
  const isBlocked = detail?.reason != null

  const postingsQuery = api.ledger.listPostingsForSource.useQuery({
    sourceKind: 'money_transaction',
    sourceId: movementId,
  })
  const postings = postingsQuery.data ?? []

  const date = detail ? (detail.occurredOn ?? detail.occurredAt?.toISOString() ?? null) : null
  const partyRole = detail?.purpose.startsWith('customer') ? 'customer' : 'vendor'
  const links = detail
    ? [
        ...(detail.partyInstanceId
          ? [
              {
                role: 'party' as const,
                instanceId: detail.partyInstanceId,
                definitionId: detail.partyDefinitionId,
                displayName: detail.partyName,
              },
            ]
          : []),
        ...detail.links,
      ]
    : []

  if (detailQuery.isPending) {
    return (
      <div className='flex flex-col gap-2 p-4'>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-40 w-full' />
      </div>
    )
  }

  if (!detail) {
    return <div className='p-4 text-muted-foreground text-sm'>No movement matches this link.</div>
  }

  return (
    <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
      <div className='flex flex-col'>
        <MetricGrid columns={2}>
          <MetricCell
            label='Date'
            icon={<CalendarClock className='size-4 text-muted-foreground' />}
            value={date ? formatAccountingDate(date, bookTimeZone) : '—'}
          />
          <MetricCell
            label='Amount'
            icon={<Coins className='size-4 text-muted-foreground' />}
            value={formatMinor(detail.amountMinor, detail.currency)}
          />
          {isBlocked && (
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
          )}
        </MetricGrid>

        {detail.reason != null && (
          <Section
            title='Why it was refused'
            icon={<CircleAlert className='size-4' />}
            description='In the ledger’s own words. Retry once the cause is fixed.'
            collapsible={false}>
            {detail.reasonKind === 'account_unmapped' ? (
              // The card's per-role row deep-links to that role under
              // Settings > Accounts > Roles - that IS the Map action.
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
        )}

        {postings.length > 0 && (
          <Section
            title='Postings'
            icon={<BookOpenCheck className='size-4' />}
            description='The entries this movement produced.'
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

        {links.length > 0 && (
          <Section
            title='Links'
            icon={<Link2 className='size-4' />}
            description='The records this movement touches.'
            collapsible={false}>
            <TreeRowList
              items={links}
              getKey={(link) => `${link.role}-${link.instanceId}`}
              renderRow={(link) => (
                <TreeRow
                  title={
                    link.definitionId ? (
                      <RecordBadge
                        recordId={toRecordId(link.definitionId, link.instanceId)}
                        size='sm'
                        link
                        openInStack
                      />
                    ) : (
                      <span className='font-mono text-xs'>
                        {link.displayName ?? link.instanceId}
                      </span>
                    )
                  }
                  trailing={
                    <Badge variant='outline' size='xs'>
                      {link.role === 'party' ? partyRole : LINK_ROLE_LABEL[link.role]}
                    </Badge>
                  }
                />
              )}
            />
          </Section>
        )}

        {/* Channel money's `reference` is the provider's own id; only a hand-recorded payment carries one somebody typed. */}
        {((detail.method && detail.reference) || detail.note) && (
          <Section title='Notes' collapsible={false}>
            <div className='flex flex-col gap-1 text-sm'>
              {detail.method && detail.reference && (
                <span>
                  <span className='text-muted-foreground'>Reference </span>
                  <span className='font-mono text-xs'>{detail.reference}</span>
                </span>
              )}
              {detail.note && <p>{detail.note}</p>}
            </div>
          </Section>
        )}
      </div>
    </ScrollArea>
  )
}
