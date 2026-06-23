// apps/web/src/components/data-connectors/ui/pagination-summary.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  AnimatedCollapsibleContent,
  Collapsible,
  CollapsibleChevron,
  CollapsibleTrigger,
} from '@auxx/ui/components/collapsible'
import { useState } from 'react'
import type { PaginationDescription } from '../lib/describe-pagination'

/**
 * Read-only "How this paginates" display (Step 10 §3.2). Collapsed shows only the
 * `kind` badge; expanded reveals the plain-language mechanics + stop condition. One
 * renderer for both the stream's *configured* pagination and an auto-*detected*
 * proposal — the only difference is the heading + the (hidden) "Use this" action.
 */

/**
 * Reveal the one-click "Use this" apply on a detected proposal. The write path is
 * fully wired (Step 10 §3.4) — flip this to `true` to expose it. Inform-only for now.
 */
export const SHOW_USE_DETECTED_PAGINATION = true

interface PaginationSummaryProps {
  description: PaginationDescription
  /** `configured` = the stream's saved spec; `detected` = a test-fetch proposal. */
  variant?: 'configured' | 'detected'
  /** Caveat shown under a detected proposal (e.g. the likely-truncated warning). */
  note?: string
  /** Persist the detected spec. Rendered behind {@link SHOW_USE_DETECTED_PAGINATION}. */
  onUse?: () => void
  useLoading?: boolean
}

export function PaginationSummary({
  description,
  variant = 'configured',
  note,
  onUse,
  useLoading,
}: PaginationSummaryProps) {
  const [open, setOpen] = useState(false)
  const heading = variant === 'detected' ? 'Detected from test fetch' : 'Pagination'

  return (
    <Collapsible open={open} onOpenChange={setOpen} className='flex flex-col gap-2 px-1'>
      <CollapsibleTrigger className='flex items-center gap-2 text-left'>
        <CollapsibleChevron open={open} className='text-muted-foreground' />
        <span className='text-xs text-muted-foreground'>{heading}</span>
        <Badge variant='secondary' size='sm'>
          {description.badge}
        </Badge>
      </CollapsibleTrigger>

      <AnimatedCollapsibleContent open={open} className='flex flex-col gap-2 pl-6'>
        <p className='text-xs text-muted-foreground'>{description.summary}</p>
        {description.details.length > 0 && (
          <dl className='flex flex-col gap-1'>
            {description.details.map((d) => (
              <div key={d.label} className='flex gap-2 text-xs'>
                <dt className='w-28 shrink-0 text-muted-foreground'>{d.label}</dt>
                <dd className='text-foreground'>{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {note && <p className='text-xs text-amber-600 dark:text-amber-500'>{note}</p>}
        {variant === 'detected' && SHOW_USE_DETECTED_PAGINATION && onUse && (
          <div>
            <Button variant='outline' size='xs' loading={useLoading} onClick={onUse}>
              Use this pagination
            </Button>
          </div>
        )}
      </AnimatedCollapsibleContent>
    </Collapsible>
  )
}
