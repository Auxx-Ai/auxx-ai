// apps/web/src/components/workflow/active-workflows-indicator.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Loader2 } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { useWorkflowRunStatusStore } from '~/stores/workflow-run-status-store'

/**
 * Shows count of active workflow runs in header/sidebar
 * Optional enhancement for visibility
 */
export function ActiveWorkflowsIndicator() {
  const activeCount = useWorkflowRunStatusStore(
    (s) => Array.from(s.runs.values()).filter((r) => r.status === 'running').length
  )

  if (activeCount === 0) return null

  return (
    <Tooltip content={`${activeCount} workflow${activeCount > 1 ? 's' : ''} running`}>
      <Badge variant='secondary' className='gap-1'>
        <Loader2 className='size-3 animate-spin' />
        {activeCount}
      </Badge>
    </Tooltip>
  )
}
