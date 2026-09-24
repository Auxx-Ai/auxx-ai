// apps/web/src/components/mail/thread-triage-indicators.tsx
'use client'

import { getOptionColor } from '@auxx/lib/custom-fields/client'
import { MAIL_CLASSIFY_SPAM_THRESHOLD } from '@auxx/lib/mail-classification/client'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import {
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  Equal,
  Frown,
  type LucideIcon,
  Meh,
  Reply,
  ShieldAlert,
  ShieldCheck,
  Smile,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import type { ThreadMeta } from '~/components/threads/store/thread-store'

type TriageColor = 'red' | 'orange' | 'blue' | 'green' | 'amber' | 'gray'

export interface TriageIndicator {
  key: 'priority' | 'needsReply' | 'sentiment' | 'spam'
  icon: LucideIcon
  color: TriageColor
  label: string
  /** Worth surfacing in a list row, not just the detail header. */
  notable: boolean
}

type TriageFields = Pick<ThreadMeta, 'priority' | 'needsReply' | 'sentiment' | 'spamScore'>

const PRIORITY: Record<NonNullable<TriageFields['priority']>, Omit<TriageIndicator, 'key'>> = {
  URGENT: { icon: ChevronsUp, color: 'red', label: 'Urgent priority', notable: true },
  HIGH: { icon: ChevronUp, color: 'orange', label: 'High priority', notable: true },
  MEDIUM: { icon: Equal, color: 'gray', label: 'Medium priority', notable: false },
  LOW: { icon: ChevronDown, color: 'gray', label: 'Low priority', notable: false },
}

const SENTIMENT: Record<NonNullable<TriageFields['sentiment']>, Omit<TriageIndicator, 'key'>> = {
  NEGATIVE: { icon: Frown, color: 'red', label: 'Negative sentiment', notable: true },
  NEUTRAL: { icon: Meh, color: 'gray', label: 'Neutral sentiment', notable: false },
  POSITIVE: { icon: Smile, color: 'green', label: 'Positive sentiment', notable: false },
}

const TEXT_COLOR: Record<TriageColor, string> = {
  red: 'text-red-500',
  orange: 'text-orange-500',
  blue: 'text-blue-500',
  green: 'text-green-500',
  amber: 'text-amber-500',
  gray: 'text-muted-foreground',
}

/** Same shape as `TagBadge size='sm'` so the header's triage badges and tags line up. */
const TRIAGE_BADGE_STYLES =
  'inline-flex h-5.5 min-w-5.5 shrink-0 items-center justify-center rounded-[5px] border px-1 [&_svg]:size-3.5'

/** The thread's triage values as indicators, in display order; `notable` mode drops the rest. */
export function getTriageIndicators(
  thread: TriageFields,
  mode: 'all' | 'notable'
): TriageIndicator[] {
  const out: TriageIndicator[] = []
  if (thread.priority) out.push({ key: 'priority', ...PRIORITY[thread.priority] })
  if (thread.needsReply != null) {
    out.push(
      thread.needsReply
        ? { key: 'needsReply', icon: Reply, color: 'blue', label: 'Needs a reply', notable: true }
        : {
            key: 'needsReply',
            icon: Reply,
            color: 'gray',
            label: 'No reply needed',
            notable: false,
          }
    )
  }
  if (thread.sentiment) out.push({ key: 'sentiment', ...SENTIMENT[thread.sentiment] })
  if (thread.spamScore != null) {
    const percent = `${Math.round(thread.spamScore * 100)}%`
    out.push(
      thread.spamScore >= MAIL_CLASSIFY_SPAM_THRESHOLD
        ? {
            key: 'spam',
            icon: ShieldAlert,
            color: 'amber',
            label: `Likely spam (${percent})`,
            notable: true,
          }
        : {
            key: 'spam',
            icon: ShieldCheck,
            color: 'gray',
            label: `Unlikely spam (${percent})`,
            notable: false,
          }
    )
  }
  return mode === 'all' ? out : out.filter((i) => i.notable)
}

/** The triage fields a human can set; `spamScore` is model-only (08 §7.1 E1). */
export type TriageUpdates = Partial<Pick<ThreadMeta, 'priority' | 'needsReply' | 'sentiment'>>
export type TriageEditField = keyof TriageUpdates

interface TriageOption {
  /** Radix radio values are strings; `needsReply` round-trips through 'true' / 'false'. */
  value: string
  label: string
  icon: LucideIcon
  color: TriageColor
}

const option = (value: string, o: Omit<TriageIndicator, 'key' | 'notable'>, label: string) => ({
  value,
  label,
  icon: o.icon,
  color: o.color,
})

export const TRIAGE_EDIT_FIELDS: Record<
  TriageEditField,
  { label: string; icon: LucideIcon; options: TriageOption[] }
> = {
  priority: {
    label: 'Priority',
    icon: ChevronsUp,
    options: [
      option('URGENT', PRIORITY.URGENT, 'Urgent'),
      option('HIGH', PRIORITY.HIGH, 'High'),
      option('MEDIUM', PRIORITY.MEDIUM, 'Medium'),
      option('LOW', PRIORITY.LOW, 'Low'),
    ],
  },
  needsReply: {
    label: 'Needs reply',
    icon: Reply,
    options: [
      { value: 'true', label: 'Needs a reply', icon: Reply, color: 'blue' },
      { value: 'false', label: 'No reply needed', icon: Reply, color: 'gray' },
    ],
  },
  sentiment: {
    label: 'Sentiment',
    icon: Meh,
    options: [
      option('NEGATIVE', SENTIMENT.NEGATIVE, 'Negative'),
      option('NEUTRAL', SENTIMENT.NEUTRAL, 'Neutral'),
      option('POSITIVE', SENTIMENT.POSITIVE, 'Positive'),
    ],
  },
}

/** Radio string → the update for `field`; `null` clears. */
export function toTriageUpdate(field: TriageEditField, value: string | null): TriageUpdates {
  if (value === null) return { [field]: null }
  if (field === 'needsReply') return { needsReply: value === 'true' }
  return { [field]: value } as TriageUpdates
}

const toRadioValue = (value: TriageUpdates[TriageEditField] | undefined) =>
  value == null ? '' : String(value)

/** Radio items for one field plus Clear, for any `DropdownMenuContent`. */
function TriageMenuItems({
  field,
  value,
  onChange,
}: {
  field: TriageEditField
  value: TriageUpdates[TriageEditField] | undefined
  onChange: (updates: TriageUpdates) => void
}) {
  return (
    <>
      <DropdownMenuRadioGroup
        value={toRadioValue(value)}
        onValueChange={(v) => onChange(toTriageUpdate(field, v))}>
        {TRIAGE_EDIT_FIELDS[field].options.map(({ value: v, label, icon: Icon, color }) => (
          <DropdownMenuRadioItem key={v} value={v} indicator='check'>
            <Icon className={TEXT_COLOR[color]} />
            {label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={value == null} onClick={() => onChange({ [field]: null })}>
        <X />
        Clear
      </DropdownMenuItem>
    </>
  )
}

/** Priority / Needs reply / Sentiment submenus: the way in for a field with no badge yet. */
export function TriageSubMenus({
  thread,
  onChange,
}: {
  thread: TriageUpdates
  onChange: (updates: TriageUpdates) => void
}) {
  return (
    <>
      {(Object.keys(TRIAGE_EDIT_FIELDS) as TriageEditField[]).map((field) => {
        const { label, icon: Icon } = TRIAGE_EDIT_FIELDS[field]
        return (
          <DropdownMenuSub key={field}>
            <DropdownMenuSubTrigger>
              <Icon />
              {label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <TriageMenuItems field={field} value={thread[field]} onChange={onChange} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )
      })}
    </>
  )
}

interface TriagePickerProps {
  field: TriageEditField
  onChange: (updates: TriageUpdates) => void
  /** Trigger; omitted when the ActionBar overflow anchors the picker via `anchorRef`. */
  children?: React.ReactNode
  anchorRef?: React.RefObject<HTMLElement | null>
  open?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  align?: 'start' | 'center' | 'end'
}

/** One triage field's values as a popover list, for the bulk toolbar's `picker` slot. */
export function TriagePicker({
  field,
  onChange,
  children,
  anchorRef,
  open,
  onOpenChange,
  disabled,
  align = 'end',
}: TriagePickerProps) {
  const [innerOpen, setInnerOpen] = useState(false)
  const isOpen = open ?? innerOpen
  const setOpen = (next: boolean) => {
    setInnerOpen(next)
    onOpenChange?.(next)
  }
  const pick = (updates: TriageUpdates) => {
    onChange(updates)
    setOpen(false)
  }
  const items = [
    ...TRIAGE_EDIT_FIELDS[field].options,
    { value: null, label: 'Clear', icon: X, color: 'gray' as const },
  ]

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      {anchorRef ? (
        <PopoverAnchor virtualRef={anchorRef} />
      ) : (
        <PopoverTrigger asChild disabled={disabled}>
          {children}
        </PopoverTrigger>
      )}
      <PopoverContent
        className='w-44 p-1'
        align={align}
        // Opened from the ActionBar overflow: focus returning to the "more" button must not close it.
        onFocusOutside={(e) => anchorRef && e.preventDefault()}>
        {items.map(({ value, label, icon: Icon, color }) => (
          <button
            key={value ?? 'clear'}
            type='button'
            className='flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent [&_svg]:size-4'
            onClick={() => pick(toTriageUpdate(field, value))}>
            <Icon className={TEXT_COLOR[color]} />
            {label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

interface ThreadTriageIndicatorsProps {
  thread: TriageFields
  mode: 'all' | 'notable'
  /** `badges` for the header, `stack` for the split-row gutter, `inline` for the compact row. */
  variant: 'badges' | 'stack' | 'inline'
  /** Cap on rendered glyphs; the header shows everything. */
  max?: number
  /** Selected row: glyphs take the row's foreground colour. */
  highlighted?: boolean
  /** `badges` only: the editable fields' badges open a menu to change them. */
  onChange?: (updates: TriageUpdates) => void
  className?: string
}

/** Priority, needs-reply, sentiment and spam as icon badges with tooltips. */
export function ThreadTriageIndicators({
  thread,
  mode,
  variant,
  max,
  highlighted,
  onChange,
  className,
}: ThreadTriageIndicatorsProps) {
  const indicators = getTriageIndicators(thread, mode).slice(0, max)
  if (indicators.length === 0) return null

  if (variant === 'badges') {
    return (
      <div className={cn('flex shrink-0 items-center gap-1', className)}>
        {indicators.map(({ key, icon: Icon, color, label }) => {
          const badgeClassName = cn(TRIAGE_BADGE_STYLES, getOptionColor(color).badgeClasses)
          if (!onChange || key === 'spam') {
            return (
              <Tooltip key={key} content={label} delayDuration={300}>
                <span className={badgeClassName} aria-label={label}>
                  <Icon />
                </span>
              </Tooltip>
            )
          }
          return (
            <DropdownMenu key={key}>
              <Tooltip content={label} delayDuration={300} allowInteraction>
                <DropdownMenuTrigger asChild>
                  <button
                    type='button'
                    className={cn(badgeClassName, 'cursor-pointer')}
                    aria-label={`${label}, change`}>
                    <Icon />
                  </button>
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent align='start'>
                <TriageMenuItems field={key} value={thread[key]} onChange={onChange} />
              </DropdownMenuContent>
            </DropdownMenu>
          )
        })}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center',
        variant === 'stack' ? 'flex-col gap-1' : 'gap-0.5',
        className
      )}>
      {indicators.map(({ key, icon: Icon, color, label }) => (
        <Tooltip key={key} content={label} delayDuration={300}>
          <span
            className={cn('flex', highlighted ? 'text-white' : TEXT_COLOR[color])}
            aria-label={label}>
            <Icon className='size-3' />
          </span>
        </Tooltip>
      ))}
    </div>
  )
}
