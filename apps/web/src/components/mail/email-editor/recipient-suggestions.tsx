// apps/web/src/components/mail/email-editor/recipient-suggestions.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Mail, Phone } from 'lucide-react'
import type { RouterOutputs } from '~/trpc/react'
import type { IdentifierModelSpec } from './identifier-model'

/**
 * One addressable row from `search.recipients` — a `Participant` (someone
 * corresponded with) or a contact never messaged. `identifier` is always the
 * exact string to commit; the client never reconstructs it.
 */
export type RecipientCandidate = RouterOutputs['search']['recipients']['candidates'][number]

/**
 * A recipient row is NOT a record row.
 *
 * `record-item.tsx` renders `secondaryInfo` — the contact's secondary DISPLAY
 * value, which is an email on every channel — and `record-picker-service.ts`
 * promotes it to the *title* when `displayName` is missing. Both are wrong for a
 * picker whose job is to tell you what clicking will send to. Here the subtitle
 * is exactly the identifier about to be committed, formatted for humans
 * (`(415) 555-1234`, never `+14155551234`).
 *
 * 🔴 When `displayName === identifier` the row collapses to ONE line. That is
 * ~31% of rows on live data (`Participant.displayName` falls back to the
 * identifier at every write site), not an edge case — without the collapse one in
 * three rows renders the same string twice.
 */
function RecipientRow({
  candidate,
  spec,
  active,
  onSelect,
  onHover,
}: {
  candidate: RecipientCandidate
  spec: IdentifierModelSpec
  active: boolean
  onSelect: () => void
  onHover: () => void
}) {
  const formatted = spec.formatDisplay(candidate.identifier)
  const collapsed = candidate.displayName === candidate.identifier
  const Icon = candidate.identifierType === 'PHONE' ? Phone : Mail

  return (
    <button
      type='button'
      role='option'
      aria-selected={active}
      // Keep focus in the input: a blur would fire `tryCommitInput` and commit
      // the half-typed query *alongside* the row being clicked.
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={onHover}
      onClick={onSelect}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent focus:outline-hidden',
        active && 'bg-accent'
      )}>
      <Icon className='size-3.5 shrink-0 text-muted-foreground' />
      <span className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate'>{collapsed ? formatted : candidate.displayName}</span>
        {!collapsed && <span className='truncate text-xs text-muted-foreground'>{formatted}</span>}
      </span>
      {candidate.source === 'contact' && (
        <span
          className='shrink-0 text-muted-foreground text-xs'
          title='You have not messaged this contact before'>
          New
        </span>
      )}
    </button>
  )
}

/**
 * The recipient suggestion list: participants ∪ contacts, already ranked and
 * already filtered to what this channel can address.
 *
 * Presentational — highlight state and keyboard handling live in
 * `RecipientInput`, because the arrow keys are typed into the input, not into
 * this list. That is deliberately unlike the record picker, which owned a cmdk
 * `Command` and had to be fed synthetic `KeyboardEvent`s.
 */
export function RecipientSuggestions({
  candidates,
  spec,
  activeIndex,
  isLoading,
  truncated,
  onSelect,
  onHover,
}: {
  candidates: RecipientCandidate[]
  spec: IdentifierModelSpec
  /** `null` when nothing is highlighted — Enter then commits the typed value. */
  activeIndex: number | null
  isLoading: boolean
  /**
   * The server's candidate ceiling bound the answer AND returned fewer rows than
   * asked for — so this SHORT list may be missing matches the viewer can see.
   *
   * Worth surfacing precisely because it is short: a truncated-but-full list looks
   * like any other page, but a truncated list of three reads as "there are three",
   * which is the one case where silence is a lie.
   */
  truncated: boolean
  onSelect: (candidate: RecipientCandidate) => void
  onHover: (index: number) => void
}) {
  if (candidates.length === 0) {
    return (
      <div className='px-3 py-2 text-muted-foreground text-sm'>
        {isLoading ? 'Searching…' : `No matching ${spec.nounPlural}`}
      </div>
    )
  }

  return (
    <div className='max-h-72 overflow-y-auto py-1'>
      <div role='listbox' aria-label={`Recipient ${spec.nounPlural}`}>
        {candidates.map((candidate, index) => (
          <RecipientRow
            key={`${candidate.identifierType}:${candidate.identifier}`}
            candidate={candidate}
            spec={spec}
            active={activeIndex === index}
            onSelect={() => onSelect(candidate)}
            onHover={() => onHover(index)}
          />
        ))}
      </div>
      {truncated && (
        <p className='border-border border-t px-3 py-1.5 text-muted-foreground text-xs'>
          Showing the closest matches — keep typing to narrow.
        </p>
      )}
    </div>
  )
}
