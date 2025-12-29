// apps/web/src/app/(public)/workflows/run/[shareToken]/loading.tsx

import { Loader2 } from 'lucide-react'

/**
 * Loading state for workflow run page
 */
export default function PublicWorkflowRunLoading() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}
