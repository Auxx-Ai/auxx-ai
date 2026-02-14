// apps/web/src/app/(protected)/app/workflows/_components/executions/workflow-run-status-badge.tsx

import type { WorkflowRunStatusValues } from '@auxx/database/enums'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { CheckCircle, Pause, Play, StopCircle, XCircle } from 'lucide-react'

export type WorkflowRunStatus = (typeof WorkflowRunStatusValues)[number]

/**
 * Status configuration for workflow runs - icons, labels, and badge variants
 */
export const workflowRunStatusConfig: Record<
  WorkflowRunStatus,
  { icon: React.ReactNode; label: string; variant: Variant }
> = {
  RUNNING: {
    icon: <Play className='size-3' />,
    label: 'Running',
    variant: 'blue',
  },
  SUCCEEDED: {
    icon: <CheckCircle className='size-3' />,
    label: 'Succeeded',
    variant: 'green',
  },
  FAILED: {
    icon: <XCircle className='size-3' />,
    label: 'Failed',
    variant: 'red',
  },
  STOPPED: {
    icon: <StopCircle className='size-3' />,
    label: 'Stopped',
    variant: 'zinc',
  },
  WAITING: {
    icon: <Pause className='size-3' />,
    label: 'Waiting',
    variant: 'yellow',
  },
}

interface WorkflowRunStatusBadgeProps {
  status: WorkflowRunStatus
  /** Whether to show the icon (default: true) */
  showIcon?: boolean
}

/**
 * Badge component for displaying workflow run status
 */
export function WorkflowRunStatusBadge({ status, showIcon = true }: WorkflowRunStatusBadgeProps) {
  const config = workflowRunStatusConfig[status]

  return (
    <Badge variant={config.variant} className='text-xs'>
      {showIcon && config.icon}
      <span className={showIcon ? 'ml-1' : ''}>{config.label}</span>
    </Badge>
  )
}
