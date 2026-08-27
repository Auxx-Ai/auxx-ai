// apps/web/src/components/dynamic-table/components/created-not-in-view-notice.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { EyeOff, X } from 'lucide-react'

interface CreatedNotInViewNoticeProps {
  /** Records created in this view that the view is not currently showing. */
  count: number
  /** Drop the view's user filters. Omit when there are none to drop. */
  onClearFilters?: () => void
  onDismiss: () => void
}

/**
 * Quiet strip: "1 record you created isn't shown here."
 *
 * Answers the question the member actually asks — *did it even save?* — which
 * they ask when the drawer closes, not when it opens. So this persists until the
 * view's question changes or it is dismissed, rather than flashing and fading;
 * in overlay mode the drawer is covering this strip at the moment it appears.
 *
 * The copy is deliberately generic. Naming the offending condition would be
 * better, but filter values are `optionId` / `recordId` / `fieldId` cuids and
 * *"`<cuid>` is `<cuid>`"* is worse than saying nothing — resolving all three
 * keyspaces to labels is its own project.
 *
 * Not an error state: muted, one line, dismissible, and rendering nothing when
 * the count is zero — which is the overwhelmingly common case, and load-bearing
 * since this mounts under every records view.
 */
export function CreatedNotInViewNotice({
  count,
  onClearFilters,
  onDismiss,
}: CreatedNotInViewNoticeProps) {
  if (count < 1) return null

  return (
    <div className='flex items-center gap-2 border-t px-4 py-1.5 text-sm text-muted-foreground'>
      <EyeOff className='size-3.5 shrink-0' />
      <span>
        {count === 1
          ? "1 record you created isn't shown with the current filters."
          : `${count} records you created aren't shown with the current filters.`}
      </span>
      {onClearFilters && (
        <Button variant='link' size='sm' className='h-auto p-0' onClick={onClearFilters}>
          Clear filters
        </Button>
      )}
      <Button
        variant='ghost'
        size='icon-xs'
        className='ml-auto'
        aria-label='Dismiss'
        onClick={onDismiss}>
        <X />
      </Button>
    </div>
  )
}
