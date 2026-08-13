// apps/web/src/components/workflow/panels/run/components/branch-group.tsx

import { Badge, type Variant as BadgeVariant } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronDown, ChevronRight, GitBranch } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { NodeRunningStatus } from '~/components/workflow/types'

/**
 * Props for BranchGroup component
 */
interface BranchGroupProps {
  /** Branch identifier (e.g., 'true', 'false', 'source', 'fail') */
  branchId: string
  /** Child nodes in this branch */
  children: React.ReactNode
  /** Overall status of nodes in this branch */
  status?: NodeRunningStatus
  /** Optional custom label */
  label?: string
  /** Optional branch index for numbering parallel branches */
  branchIndex?: number
}

/**
 * Format branch ID into readable label
 */
function formatBranchLabel(branchId: string, branchIndex?: number): string {
  const labelMap: Record<string, string> = {
    true: 'True Branch',
    false: 'False Branch',
    fail: 'Fail Path',
    success: 'Success Path',
  }

  // If it's a known label, return it
  if (labelMap[branchId]) {
    return labelMap[branchId]
  }

  // For 'source' branches (parallel branches with source handle), use index if provided
  if (branchId === 'source' && branchIndex !== undefined) {
    return `Branch ${branchIndex + 1}`
  }

  // Custom branch IDs
  return `${branchId.charAt(0).toUpperCase()}${branchId.slice(1)} Branch`
}

/**
 * Get badge variant based on status
 */
function getStatusVariant(status?: NodeRunningStatus): BadgeVariant {
  switch (status) {
    case NodeRunningStatus.Succeeded:
      return 'green'
    case NodeRunningStatus.Failed:
    case NodeRunningStatus.Exception:
      return 'destructive'
    case NodeRunningStatus.Running:
      return 'amber'
    case NodeRunningStatus.Skipped:
      // Folded shut and inert — reads flatter than a branch still to come
      return 'outline'
    case NodeRunningStatus.Pending:
    case NodeRunningStatus.Waiting:
      return 'secondary'
    default:
      return 'default'
  }
}

/**
 * Get border color class based on status
 */
function getBorderColor(status?: NodeRunningStatus): string {
  switch (status) {
    case NodeRunningStatus.Succeeded:
      return 'border-green-500/30'
    case NodeRunningStatus.Failed:
    case NodeRunningStatus.Exception:
      return 'border-red-500/30'
    case NodeRunningStatus.Running:
      return 'border-amber-500/30'
    case NodeRunningStatus.Pending:
    case NodeRunningStatus.Waiting:
      return 'border-gray-500/20'
    case NodeRunningStatus.Skipped:
      return 'border-muted/30'
    default:
      return 'border-border/50'
  }
}

/**
 * Branch grouping component for execution tree
 * Visually groups nodes that belong to the same branch path
 */
export function BranchGroup({ branchId, children, status, label, branchIndex }: BranchGroupProps) {
  // A branch folds away until the run actually enters it: Pending has not been
  // reached yet, Skipped never will be. It unfolds on its own the moment the
  // branch starts running, and stays open once it has run.
  const collapsedByStatus =
    status === NodeRunningStatus.Pending || status === NodeRunningStatus.Skipped

  // Toggling the header pins the branch open or shut, overriding the status.
  const [override, setOverride] = useState<boolean | null>(null)
  const isCollapsed = override ?? collapsedByStatus

  // Back at Pending means a new run started — drop the last run's toggle so the
  // branch follows the new run again.
  useEffect(() => {
    if (status === NodeRunningStatus.Pending) setOverride(null)
  }, [status])

  const displayLabel = label || formatBranchLabel(branchId, branchIndex)
  const borderColor = getBorderColor(status)
  const statusVariant = getStatusVariant(status)

  return (
    <div
      className={cn(
        'relative border-l-2 ml-3 pl-3 py-1 my-1',
        borderColor,
        'transition-colors duration-200'
      )}>
      {/* Branch header */}
      <button
        onClick={() => setOverride(!isCollapsed)}
        className={cn(
          'flex items-center gap-2 mb-2 text-sm font-medium',
          'hover:text-primary transition-colors',
          'cursor-pointer group'
        )}>
        {isCollapsed ? (
          <ChevronRight className='h-3 w-3 text-muted-foreground group-hover:text-primary' />
        ) : (
          <ChevronDown className='h-3 w-3 text-muted-foreground group-hover:text-primary' />
        )}
        <GitBranch className='h-3 w-3 text-muted-foreground' />
        <span className='text-muted-foreground'>{displayLabel}</span>
        {status && (
          <Badge variant={statusVariant} className='text-xs px-1.5 py-0'>
            {status}
          </Badge>
        )}
      </button>

      {/* Branch content */}
      {!isCollapsed && <div className='space-y-0.5'>{children}</div>}
    </div>
  )
}
