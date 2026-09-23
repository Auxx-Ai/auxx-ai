// apps/web/src/components/accounting/ui/ledger/summary-frame.tsx

'use client'

import {
  exportObjectTypeLabel,
  parseUnbuiltGroupKey,
  summaryRowStatus,
} from '@auxx/lib/accounting/export/client'
import type { ResolvedPostingLine } from '@auxx/lib/accounting/ledger/client'
import { Badge } from '@auxx/ui/components/badge'
import { MetricCell, MetricGrid } from '@auxx/ui/components/metric-grid'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Section } from '@auxx/ui/components/section'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { BookOpenCheck, CalendarClock, Coins, FileClock, Layers } from 'lucide-react'
import { toFrame, useOpenRecord } from '~/components/records/record-drill-panels'
import { api, type RouterOutputs } from '~/trpc/react'
import { EntryJournal } from './entry-journal'
import { exportAvenueLabel } from './export-avenue-labels'
import { EMPTY_CELL, formatAccountingDate, formatMinor } from './format'
import { SummaryStatusBadge } from './outbox/export-batch-badge'
import { dayKeyLabel } from './outbox/group-row'
import { PostingLinks } from './outbox/posting-links'
import type { FrameHeader } from './posting-frame'
import { postingTypeLabel } from './type-labels'

type SummaryBucket = RouterOutputs['ledger']['exportBatches']['summaryBucket']
type BucketMember = SummaryBucket['members'][number]

/** The `?summary=` read; disabled for a null or malformed key. */
function useSummaryBucket(summaryKey: string | null) {
  const key = summaryKey ? parseUnbuiltGroupKey(summaryKey) : null
  const query = api.ledger.exportBatches.summaryBucket.useQuery(
    { key: key ?? { avenue: 'journal', grainKey: '', storeId: null, railId: null, currency: '' } },
    { enabled: !!key }
  )
  return { key, query }
}

/** The summary frame's identity strip, read by the host (83 §2.4). */
export function useSummaryFrameHeader(summaryKey: string | null): FrameHeader {
  const { key, query } = useSummaryBucket(summaryKey)
  const bucket = query.data
  const status = bucket
    ? summaryRowStatus(bucket.batch?.state ?? null, bucket.newMembers.length)
    : null
  const label = key ? `${exportAvenueLabel(key.avenue)} summary` : 'Summary'
  return {
    drawerTitle: label,
    icon: <Layers className='size-5 text-muted-foreground' />,
    title: (
      <div className='flex flex-wrap items-center gap-2'>
        <span className='font-medium'>{label}</span>
        {bucket?.batch?.docNumber && (
          <span className='font-mono text-muted-foreground text-xs'>{bucket.batch.docNumber}</span>
        )}
        {status && (
          <SummaryStatusBadge
            status={status}
            newCount={bucket?.newMembers.length ?? 0}
            failureClass={bucket?.batch?.failureClass ?? null}
          />
        )}
      </div>
    ),
    actions: null,
  }
}

interface SummaryFrameProps {
  /** `unbuiltGroupKeyString` of the bucket, from `?summary=` or a `~summary:` frame. */
  summaryKey: string
  bookTimeZone: string
  providerLabel: string
}

/** One Summary row: the journal it sends, then the postings it is summed from. */
export function SummaryFrame({ summaryKey, bookTimeZone, providerLabel }: SummaryFrameProps) {
  const openFrame = useOpenRecord()
  const { key, query } = useSummaryBucket(summaryKey)
  const bucket = query.data

  if (!key) {
    return <div className='p-4 text-muted-foreground text-sm'>No summary matches this link.</div>
  }

  if (query.isPending) {
    return (
      <div className='flex flex-col gap-2 p-4'>
        <Skeleton className='h-20 w-full' />
        <Skeleton className='h-40 w-full' />
      </div>
    )
  }

  if (!bucket || (bucket.members.length === 0 && !bucket.batch)) {
    return (
      <div className='p-4 text-muted-foreground text-sm'>
        Nothing is left in this summary. Its postings may have been sent in another batch.
      </div>
    )
  }

  const { batch, members, newMembers } = bucket
  const lines: ResolvedPostingLine[] = bucket.lines.map((line, index) => ({
    glAccountId: line.glAccountId,
    accountCode: line.accountCode || null,
    accountName: line.accountName ?? undefined,
    direction: line.direction,
    amount: line.amountMinor,
    sourceType: 'export_summary',
    sourceId: summaryKey,
    sortOrder: index,
  }))
  const total = lines
    .filter((line) => line.direction === 'debit')
    .reduce((sum, line) => sum + line.amount, 0)
  const openPosting = (glPostingId: string) => openFrame?.(toFrame('posting', glPostingId))

  return (
    <ScrollArea className='min-h-0 flex-1' scrollbarClassName='w-1.5'>
      <div className='flex flex-col'>
        <MetricGrid columns={2}>
          <MetricCell
            label='Date'
            icon={<CalendarClock className='size-4 text-muted-foreground' />}
            value={dayKeyLabel(batch?.dayKey ?? members[0]?.txnDate ?? null, bookTimeZone)}
          />
          <MetricCell
            label='Total'
            icon={<Coins className='size-4 text-muted-foreground' />}
            value={formatMinor(total, key.currency)}
          />
        </MetricGrid>

        <Section
          title={exportObjectTypeLabel(batch?.objectType ?? 'journal')}
          icon={<BookOpenCheck className='size-4' />}
          description={
            batch
              ? `The lines frozen into this batch, as ${providerLabel} receives them.`
              : `Not built yet: what Send would build now, every posting below summed per account and side.`
          }
          collapsible={false}>
          {lines.length >= 2 ? (
            <EntryJournal lines={lines} currencyCode={key.currency} />
          ) : (
            <p className='text-muted-foreground text-sm'>
              Fewer than two non-zero lines, so there is no journal to send.
            </p>
          )}
        </Section>

        <Section
          title='Postings'
          icon={<FileClock className='size-4' />}
          description={`The ${members.length} ${members.length === 1 ? 'entry' : 'entries'} this journal is summed from.`}
          collapsible={false}>
          <MemberList
            members={members}
            currencyCode={key.currency}
            bookTimeZone={bookTimeZone}
            onOpen={openPosting}
          />
        </Section>

        {newMembers.length > 0 && (
          <Section
            title='Not in this journal'
            icon={<FileClock className='size-4' />}
            description='Posted after the batch was built, so the lines above leave them out.'
            collapsible={false}>
            <MemberList
              members={newMembers}
              currencyCode={key.currency}
              bookTimeZone={bookTimeZone}
              onOpen={openPosting}
              isNew
            />
          </Section>
        )}
      </div>
    </ScrollArea>
  )
}

function MemberList({
  members,
  currencyCode,
  bookTimeZone,
  onOpen,
  isNew = false,
}: {
  members: BucketMember[]
  currencyCode: string
  bookTimeZone: string
  onOpen: (glPostingId: string) => void
  isNew?: boolean
}) {
  return (
    <TreeRowList
      items={members}
      getKey={(member) => member.glPostingId}
      renderRow={(member) => (
        <TreeRow
          icon={<FileClock className='size-4' />}
          title={
            <span className='flex min-w-0 items-center gap-1.5'>
              <span className='shrink-0 font-mono text-muted-foreground text-xs tabular-nums'>
                {formatAccountingDate(member.txnDate, bookTimeZone)}
              </span>
              <span className='truncate text-sm'>
                {member.docNumber || member.memo || EMPTY_CELL}
              </span>
            </span>
          }
          secondary={
            <span className='flex min-w-0 items-center gap-1'>
              <Badge variant='outline' size='xs'>
                {postingTypeLabel(member.postingType)}
              </Badge>
              {isNew && (
                <Badge variant='blue' size='xs'>
                  new
                </Badge>
              )}
              <PostingLinks sources={member.sources} />
            </span>
          }
          actions={
            <span className='font-mono text-xs tabular-nums'>
              {formatMinor(member.totalMinor, currencyCode)}
            </span>
          }
          onToggleOpen={() => onOpen(member.glPostingId)}
        />
      )}
    />
  )
}
