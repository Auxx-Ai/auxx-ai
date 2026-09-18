// apps/web/src/components/accounting/ui/reports/completeness-banner.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { TreeRow } from '@auxx/ui/components/tree-row'
import { CircleSlash, Info } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { api } from '~/trpc/react'

export interface CompletenessBannerProps {
  /** `YYYY-MM-DD`. */
  asOf: string
}

/**
 * "Report completeness is not report correctness" (`plans/accounting/tasks/
 * 04-statements.md` §3), rendered on every statement page: the disabled posting
 * types in words, and the two bank-feed placeholders (`ledgerReports.
 * completeness` already flattens the buckets into `items`, hidden here whenever
 * the underlying list is empty - there is nothing to render a UI for).
 *
 * 🛑 Every item under this title must be genuinely ABSENT from the figures
 * above it. The export backlog used to be listed here and is not, because it
 * never was absent - see `completeness.ts`'s header. The outbox owns that
 * question; this row owns "what is missing from the numbers".
 *
 * ## One row, COLLAPSED, and no card around it
 *
 * ⚠️ The items are a standing condition, not news. They change on a deploy, so
 * the same handful of sentences render above every statement the org will ever
 * open, and as an open `Alert` with a button each they took more vertical space
 * at the top of a report than the report's own first section. Collapsed, the
 * page says the one thing a reader needs at a glance - that this statement has
 * caveats, and how many - and the sentences are one click away.
 *
 * 🛑 The `TreeRow` IS the item; there is no framed card around it. A border
 * round a single row would make a footnote look like a section, and it sits
 * directly above a statement that already carries its own frame.
 *
 * Renders nothing while `items` is empty - a books-complete org gets no row at
 * all, not an empty "all clear" one - and nothing on a transport error, since a
 * missing row is a much smaller problem than a toast fighting the page's own
 * `ReportErrorCard` for attention.
 */
export function CompletenessBanner({ asOf }: CompletenessBannerProps) {
  const { data } = api.ledgerReports.completeness.useQuery({ asOf }, { enabled: !!asOf })
  const [isOpen, setIsOpen] = useState(false)
  const items = data?.items ?? []

  if (items.length === 0) return null

  return (
    <TreeRow
      expandable
      isOpen={isOpen}
      onToggleOpen={() => setIsOpen((open) => !open)}
      icon={<Info className='size-4 text-muted-foreground' />}
      title='Not included in this report'
      secondary={<span className='text-muted-foreground text-xs'>{items.length}</span>}>
      {items.map((item) => (
        <TreeRow
          key={item.id}
          depth={1}
          icon={<CircleSlash className='size-4 text-muted-foreground' />}
          title={
            // WRAPS, where `TreeRow`'s title truncates by default. An item is a
            // whole sentence naming what a statement is missing and why; clipped
            // at the row edge it keeps the what and drops the why, which is the
            // half that tells a reader whether to care.
            <span className='block whitespace-normal py-1 text-sm'>{item.label}</span>
          }
          actions={
            item.remedy && (
              <Button asChild variant='outline' size='xs'>
                <Link href={item.remedy.href}>{item.remedy.label}</Link>
              </Button>
            )
          }
        />
      ))}
    </TreeRow>
  )
}
