// apps/web/src/components/resources/ui/record-link.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { cn } from '@auxx/ui/lib/utils'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useOpenRecordLinkClick } from '~/components/records/record-drill-panels'
import { type GetRecordLinkOptions, useRecordLink } from '../utils/get-record-link'

interface RecordLinkProps {
  recordId?: RecordId | null
  /** Link text (or any inline content). */
  children: ReactNode
  /** Applied to both the anchor and the no-href fallback; the anchor also gets `hover:underline`. */
  className?: string
  /** Link-builder options, e.g. `{ tab: 'vendors' }`. */
  link?: GetRecordLinkOptions
  /** See `RecordBadge.openInStack` — opt in to opening in the drawer's peek stack. */
  openInStack?: boolean
}

/**
 * A record's display name as a link to its detail page.
 *
 * The text-only sibling of `RecordBadge` (no icon, no hover card), for table
 * cells and field-panel rows where a badge would be too heavy. Exists as a
 * component rather than an inline `<Link>` because both `useRecordLink` and
 * `useOpenRecordLinkClick` are hooks and these render in loops.
 *
 * The href resolves through `resourceHasDetailPage`, so a definition with no
 * detail page degrades to plain text instead of a 404 — which is why the
 * hand-written `/app/parts?id=` paths this replaced were a hazard.
 */
export function RecordLink({ recordId, children, className, link, openInStack }: RecordLinkProps) {
  const href = useRecordLink(recordId ?? null, link)
  const handleStackOpen = useOpenRecordLinkClick(recordId, openInStack)

  if (!href) return <span className={className}>{children}</span>

  return (
    <Link href={href} className={cn(className, 'hover:underline')} onClick={handleStackOpen}>
      {children}
    </Link>
  )
}
