// apps/web/src/components/workflow/viewer/dynamic-workflow-viewer.tsx

'use client'

import { Spinner } from '@auxx/ui/components/spinner'
import dynamic from 'next/dynamic'

export const DynamicWorkflowViewer = dynamic(
  () => import('./workflow-viewer').then((m) => m.WorkflowViewer),
  {
    ssr: false,
    loading: () => (
      <div className='flex h-full items-center justify-center'>
        <Spinner className='size-5 text-muted-foreground' />
      </div>
    ),
  }
)
