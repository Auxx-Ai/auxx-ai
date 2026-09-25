// apps/web/src/components/global/report-grid/report-page-layout.tsx

'use client'

import type { ReactNode } from 'react'

/**
 * A report page: notices at their natural height, then the body filling the
 * rest. The table scrolls inside its own frame (108-D2), so the page does not.
 * `62rem` is `max-w-5xl` less the old page padding, the width a narrow table keeps.
 */
export function ReportPageLayout({
  notices,
  children,
}: {
  notices?: ReactNode
  children: ReactNode
}) {
  return (
    <div className='flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-3 p-4'>
      <div className='mx-auto flex w-full max-w-[62rem] shrink-0 flex-col gap-3 empty:hidden'>
        {notices}
      </div>
      <div className='flex min-h-0 min-w-0 flex-1 flex-col'>{children}</div>
    </div>
  )
}

/** A skeleton, an empty state or an error, at the width the reports had before 108. */
export function ReportMessage({ children }: { children: ReactNode }) {
  // A flex column filling the body, so `EmptyState`'s `flex-1` centres it as before.
  return <div className='mx-auto flex w-full max-w-[62rem] flex-1 flex-col'>{children}</div>
}
