// apps/web/src/components/mail/thread-triage-indicators.tsx
'use client'

import { MAIL_CLASSIFY_SPAM_THRESHOLD } from '@auxx/lib/mail-classification/client'
import { Badge } from '@auxx/ui/components/badge'
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
} from 'lucide-react'
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

interface ThreadTriageIndicatorsProps {
  thread: TriageFields
  mode: 'all' | 'notable'
  /** `badges` for the header, `stack` for the split-row gutter, `inline` for the compact row. */
  variant: 'badges' | 'stack' | 'inline'
  /** Cap on rendered glyphs; the header shows everything. */
  max?: number
  /** Selected row: glyphs take the row's foreground colour. */
  highlighted?: boolean
  className?: string
}

/** Priority, needs-reply, sentiment and spam as icon badges with tooltips. */
export function ThreadTriageIndicators({
  thread,
  mode,
  variant,
  max,
  highlighted,
  className,
}: ThreadTriageIndicatorsProps) {
  const indicators = getTriageIndicators(thread, mode).slice(0, max)
  if (indicators.length === 0) return null

  if (variant === 'badges') {
    return (
      <div className={cn('flex shrink-0 items-center gap-1', className)}>
        {indicators.map(({ key, icon: Icon, color, label }) => (
          <Tooltip key={key} content={label} delayDuration={300}>
            <Badge variant={color} size='xs' className='h-5 px-1' aria-label={label}>
              <Icon />
            </Badge>
          </Tooltip>
        ))}
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
