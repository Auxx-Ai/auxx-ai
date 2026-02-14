// apps/web/src/app/(public)/workflows/run/layout.tsx

import type { ReactNode } from 'react'

/**
 * Layout for public workflow run pages
 * Minimal layout without app chrome
 */
export default function PublicWorkflowRunLayout({ children }: { children: ReactNode }) {
  return <div className='min-h-screen bg-background'>{children}</div>
}
