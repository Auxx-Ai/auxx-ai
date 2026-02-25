// apps/web/src/app/(protected)/app/workflows/_components/executions/workflow-runs-columns.tsx

import type { WorkflowTriggerSourceValues } from '@auxx/database/enums'
import type { WorkflowRunEntity as WorkflowRun } from '@auxx/database/types'
import { Badge } from '@auxx/ui/components/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@auxx/ui/components/dropdown-menu'
import {
  CalendarClock,
  CircleDot,
  Clock,
  Coins,
  GitBranch,
  Globe,
  Hash,
  Key,
  PanelRight,
  Play,
  Square,
  StopCircle,
  Trash2,
  Webhook,
  XCircle,
  Zap,
} from 'lucide-react'
import type { ExtendedColumnDef } from '~/components/dynamic-table'
import { CellPadding, FormattedCell, PrimaryCell } from '~/components/dynamic-table'
import { ItemsCellView } from '~/components/ui/items-list-view'
import { type WorkflowRunStatus, WorkflowRunStatusBadge } from './workflow-run-status-badge'

type WorkflowTriggerSource = (typeof WorkflowTriggerSourceValues)[number]
/**
 * Trigger source icons and labels
 */
const triggerSourceConfig: Record<
  WorkflowTriggerSource,
  { icon: React.ReactNode; label: string; variant: 'default' | 'secondary' | 'outline' }
> = {
  DEBUGGING: { icon: <Zap className='size-3' />, label: 'Debug', variant: 'secondary' },
  APP_RUN: { icon: <Play className='size-3' />, label: 'App Run', variant: 'default' },
  SINGLE_STEP: { icon: <Square className='size-3' />, label: 'Single Step', variant: 'outline' },
  PUBLIC_SHARE: { icon: <Globe className='size-3' />, label: 'Public Share', variant: 'outline' },
  API_KEY: { icon: <Key className='size-3' />, label: 'API Key', variant: 'secondary' },
  WEBHOOK: { icon: <Webhook className='size-3' />, label: 'Webhook', variant: 'default' },
}
/**
 * Format elapsed time in human readable format
 */
const formatElapsedTime = (elapsedTime: number | null): string => {
  if (!elapsedTime) return 'N/A'
  if (elapsedTime < 1000) {
    return `${elapsedTime}ms`
  } else if (elapsedTime < 60000) {
    return `${(elapsedTime / 1000).toFixed(1)}s`
  } else if (elapsedTime < 3600000) {
    return `${(elapsedTime / 60000).toFixed(1)}m`
  } else {
    return `${(elapsedTime / 3600000).toFixed(1)}h`
  }
}
/**
 * Interface for column actions
 */
export interface WorkflowRunsColumnActions {
  onStopRun: (run: WorkflowRun) => void
  onViewDetails: (run: WorkflowRun) => void
  onDeleteRun: (run: WorkflowRun) => void
}

/**
 * Props for RunIdCell component
 */
interface RunIdCellProps {
  run: WorkflowRun
  onViewDetails: (run: WorkflowRun) => void
  onStopRun: (run: WorkflowRun) => void
  onDeleteRun: (run: WorkflowRun) => void
}

/**
 * Create workflow runs table columns
 */
export const createWorkflowRunsColumns = (
  actions: WorkflowRunsColumnActions
): ExtendedColumnDef<WorkflowRun>[] => [
  {
    id: 'runId',
    header: 'Run ID',
    icon: Hash,
    accessorFn: (row) => row.id,
    cell: ({ row }) => {
      const run = row.original
      const shortId = run.id.slice(-5)
      const isRunning = run.status === 'RUNNING'
      return (
        <PrimaryCell
          value={shortId}
          prefixIcon={<Hash className='size-3 text-muted-foreground' />}
          titleClassName='font-mono text-sm'
          onTitleClick={() => actions.onViewDetails(run)}>
          <DropdownMenuItem onClick={() => actions.onViewDetails(run)}>
            <PanelRight />
            View Details
          </DropdownMenuItem>
          {run.status === 'FAILED' && run.error && (
            <DropdownMenuItem onClick={() => actions.onViewDetails(run)}>
              <XCircle />
              View Error
            </DropdownMenuItem>
          )}
          {isRunning && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={() => actions.onStopRun(run)}>
                <StopCircle />
                Stop Execution
              </DropdownMenuItem>
            </>
          )}
          {!isRunning && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant='destructive' onClick={() => actions.onDeleteRun(run)}>
                <Trash2 />
                Delete Run
              </DropdownMenuItem>
            </>
          )}
        </PrimaryCell>
      )
    },
    enableSorting: false,
    enableHiding: false,
    defaultVisible: true,
    minSize: 120,
    maxSize: 160,
    primaryCell: true,
  },
  {
    id: 'status',
    header: 'Status',
    icon: CircleDot,
    accessorFn: (row) => row.status,
    cell: ({ getValue }) => {
      const status = getValue<WorkflowRunStatus>()
      return (
        <ItemsCellView
          item={status}
          renderItem={() => <WorkflowRunStatusBadge status={status} />}
        />
      )
    },
    enableSorting: true,
    filterFn: 'equals',
    defaultVisible: true,
    minSize: 120,
    maxSize: 150,
  },
  {
    id: 'triggeredFrom',
    header: 'Trigger',
    icon: Zap,
    accessorFn: (row) => row.triggeredFrom,
    cell: ({ getValue }) => {
      const trigger = getValue<WorkflowTriggerSource>()
      const config = triggerSourceConfig[trigger]
      return (
        <ItemsCellView
          item={trigger}
          renderItem={() => (
            <Badge variant={config.variant} className='text-xs'>
              {config.icon}
              <span className='ml-1'>{config.label}</span>
            </Badge>
          )}
        />
      )
    },
    enableSorting: true,
    filterFn: 'equals',
    defaultVisible: true,
    minSize: 100,
    maxSize: 140,
  },
  {
    id: 'version',
    header: 'Version',
    icon: GitBranch,
    accessorFn: (row) => row.version,
    cell: ({ getValue }) => {
      const version = getValue<string>()
      return (
        <CellPadding>
          <div className='flex items-center gap-1 text-sm'>
            <GitBranch className='size-3 text-muted-foreground' />
            <span className='font-mono'>{version}</span>
          </div>
        </CellPadding>
      )
    },
    enableSorting: true,
    defaultVisible: true,
    minSize: 80,
    maxSize: 120,
  },
  {
    id: 'elapsedTime',
    header: 'Duration',
    icon: Clock,
    accessorFn: (row) => row.elapsedTime,
    cell: ({ getValue }) => {
      const elapsedTime = getValue<number | null>()
      return (
        <CellPadding>
          <div className='flex items-center gap-1 text-sm text-muted-foreground'>
            <Clock className='size-3' />
            <span>{formatElapsedTime(elapsedTime)}</span>
          </div>
        </CellPadding>
      )
    },
    enableSorting: true,
    sortingFn: 'basic',
    defaultVisible: true,
    minSize: 100,
    maxSize: 140,
  },
  {
    id: 'totalTokens',
    header: 'Tokens',
    icon: Coins,
    accessorFn: (row) => row.totalTokens,
    cell: ({ getValue }) => {
      const tokens = getValue<number>()
      return (
        <CellPadding>
          <div className='flex items-center gap-1 text-sm text-muted-foreground'>
            <Coins className='size-3' />
            <span>{tokens.toLocaleString()}</span>
          </div>
        </CellPadding>
      )
    },
    enableSorting: true,
    sortingFn: 'basic',
    defaultVisible: true,
    minSize: 80,
    maxSize: 120,
  },
  {
    id: 'createdAt',
    header: 'Created',
    icon: CalendarClock,
    fieldType: 'DATETIME',
    columnType: 'date',
    accessorFn: (row) => row.createdAt,
    cell: ({ getValue }) => (
      <FormattedCell value={getValue()} fieldType='DATETIME' columnId='createdAt' />
    ),
    enableSorting: true,
    sortingFn: 'datetime',
    defaultVisible: true,
    minSize: 120,
    maxSize: 180,
  },
]
