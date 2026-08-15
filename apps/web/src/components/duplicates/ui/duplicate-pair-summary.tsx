// apps/web/src/components/duplicates/ui/duplicate-pair-summary.tsx
'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'

/**
 * The pair-rendering vocabulary shared by the Approvals-tab row (§3.2) and the
 * per-record header popover (§3.3).
 *
 * It lives here rather than inside either caller because the two need exactly
 * the same three things — who the records are, how confident the engine is, and
 * what matched — while their chrome is entirely different (a `NotificationRow`
 * card vs. a header popover). Keeping the body in one place is what stops the
 * two surfaces describing the same pair differently.
 *
 * Everything here is presentational: no queries, no mutations, no record
 * fetching. The pair read already returns both sides' display columns, so
 * reaching for `RecordBadge` (which resolves its own record) would add one query
 * per side for data already in hand.
 */

/** One side of a pair, as the router returns it. */
export interface DuplicateRecordSummary {
  recordId: string
  displayName: string | null
  secondaryDisplayValue: string | null
  avatarUrl: string | null
}

/**
 * One piece of evidence.
 *
 * `value` is the matched value, not just the field — contact `primary_email`,
 * contact `phone` and company `website` are multi-value, so "matched on: email"
 * cannot say *which* address, which is precisely the fact a reviewer needs
 * before merging. `otherValue` is present only when the two sides matched on
 * DIFFERENT values (a nickname, a trigram-tolerant surname, a domain-shape
 * variant).
 */
export interface DuplicateSignalSummary {
  type: string
  value: string
  otherValue?: string
  fieldKey?: string
}

/** Human labels for `SignalType`. Unknown types fall back to the raw string. */
const SIGNAL_LABELS: Record<string, string> = {
  email: 'Email',
  phone: 'Phone',
  unique: 'Unique field',
  name: 'Name',
  company: 'Company',
  address: 'Address',
  identity: 'External ID',
  ingest: 'Same import',
}

function initials(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * Confidence, as a badge.
 *
 * There is deliberately no `low`: a pair we would not ask a human to look at is
 * a pair the engine does not store, so the badge only ever has two states and
 * says which kind of evidence produced it.
 */
export function DuplicateBandBadge({ band }: { band: string }) {
  return (
    <Badge variant={band === 'high' ? 'amber' : 'secondary'} className='shrink-0 text-[10px]'>
      {band === 'high' ? 'Likely duplicate' : 'Possible duplicate'}
    </Badge>
  )
}

/** One record: avatar, name, and whatever the definition uses as its subtitle. */
export function DuplicateRecordCard({
  record,
  className,
}: {
  record: DuplicateRecordSummary
  className?: string
}) {
  const name = record.displayName?.trim() || 'Untitled'
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <Avatar className='size-6 shrink-0'>
        {record.avatarUrl ? <AvatarImage src={record.avatarUrl} alt={name} /> : null}
        <AvatarFallback className='text-[10px] font-medium'>
          {initials(record.displayName)}
        </AvatarFallback>
      </Avatar>
      <div className='min-w-0'>
        {/* min-w-0 on the flex child, not just `truncate` on the text: a nowrap
            string still reports its full min-content width and would blow the
            row out otherwise. */}
        <div className='truncate text-sm leading-5'>{name}</div>
        {record.secondaryDisplayValue ? (
          <div className='truncate text-muted-foreground text-xs leading-4'>
            {record.secondaryDisplayValue}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** `matched on: Email · bob@acme.com` — one chip per signal. */
export function DuplicateSignalChips({
  signals,
  className,
}: {
  signals: DuplicateSignalSummary[]
  className?: string
}) {
  if (signals.length === 0) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      <span className='text-muted-foreground text-xs'>matched on:</span>
      {signals.map((signal) => (
        <span
          key={`${signal.type}:${signal.value}:${signal.otherValue ?? ''}`}
          className='inline-flex max-w-full items-center gap-1 truncate rounded-[5px] bg-muted px-1.5 py-0.5 text-[11px] text-foreground/80 ring-1 ring-border'>
          <span className='shrink-0 text-muted-foreground'>
            {SIGNAL_LABELS[signal.type] ?? signal.type}
          </span>
          <span className='truncate'>
            {signal.otherValue ? `${signal.value} ↔ ${signal.otherValue}` : signal.value}
          </span>
        </span>
      ))}
    </div>
  )
}

/** The whole body: both records, the band, and the evidence. */
export function DuplicatePairSummary({
  records,
  band,
  signals,
  className,
}: {
  records: DuplicateRecordSummary[]
  band: string
  signals: DuplicateSignalSummary[]
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className='flex flex-col gap-1.5'>
        {records.map((record) => (
          <DuplicateRecordCard key={record.recordId} record={record} />
        ))}
      </div>
      <div className='flex flex-wrap items-center gap-1.5'>
        <DuplicateBandBadge band={band} />
        <DuplicateSignalChips signals={signals} />
      </div>
    </div>
  )
}
