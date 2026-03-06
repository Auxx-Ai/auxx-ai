// apps/web/src/components/workflow/panels/run/components/node-execution-card.tsx

import { WorkflowRunStatus as WorkflowRunStatusEnum } from '@auxx/database/enums'
import type {
  WorkflowNodeExecutionEntity as WorkflowNodeExecution,
  WorkflowRunStatus,
} from '@auxx/database/types'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import { cn } from '@auxx/ui/lib/utils'
import {
  AlertCircle,
  Check,
  CheckCircle,
  ChevronRight,
  Clock,
  Coins,
  Copy,
  FileInput,
  FileOutput,
  FileText,
  Hash,
  Loader2,
} from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { NodeRunningStatus } from '~/components/workflow/types'
import { unifiedNodeRegistry } from '../../../nodes/unified-registry'

interface NodeExecutionCardProps {
  execution: WorkflowNodeExecution
  workflowStatus?: WorkflowRunStatus
  children?: React.ReactNode
}
/**
 * Helper function to format time duration
 */
const formatTime = (seconds?: number | null) => {
  if (!seconds) return '0ms'
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  if (seconds < 60) return `${seconds.toFixed(2)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`
}
/**
 * Helper function to format token counts
 */
const formatTokens = (tokens?: number | null) => {
  if (!tokens) return '0'
  if (tokens < 1000) return tokens.toString()
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`
  return `${(tokens / 1000000).toFixed(1)}M`
}
/**
 * Helper function to compute the display status when workflow status doesn't match node status
 * This ensures that when a workflow fails/stops, nodes don't stay in "running" or "pending" state
 */
const computeDisplayStatus = (
  nodeStatus: NodeRunningStatus,
  workflowStatus: WorkflowRunStatus | undefined,
  hasError: boolean
): NodeRunningStatus => {
  // If workflow is not in a terminal state, show actual status
  if (!workflowStatus || workflowStatus === WorkflowRunStatusEnum.RUNNING) {
    return nodeStatus
  }

  // Workflow is in terminal state (FAILED, SUCCEEDED, STOPPED, WAITING)
  // Override nodes still showing as Running or Pending
  if (nodeStatus === NodeRunningStatus.Running || nodeStatus === NodeRunningStatus.Pending) {
    if (workflowStatus === WorkflowRunStatusEnum.FAILED) {
      // If node has error, mark as Failed, otherwise Stopped (didn't complete)
      return hasError ? NodeRunningStatus.Failed : NodeRunningStatus.Stopped
    }
    if (workflowStatus === WorkflowRunStatusEnum.STOPPED) {
      return NodeRunningStatus.Stopped
    }
    // For SUCCEEDED/WAITING, if node never finished, mark as Skipped
    return NodeRunningStatus.Skipped
  }

  // For all other statuses (Succeeded, Failed, Exception, Skipped, Stopped, Paused),
  // show the actual status
  return nodeStatus
}

/**
 * Helper function to get status icon based on execution status
 */
const getStatusIcon = (status: NodeRunningStatus) => {
  switch (status) {
    case NodeRunningStatus.Running:
      return <Loader2 className='size-4 animate-spin text-blue-500' />
    case NodeRunningStatus.Succeeded:
      return <CheckCircle className='size-4 text-green-500' />
    case NodeRunningStatus.Failed:
      return <AlertCircle className='size-4 text-red-500' />
    case NodeRunningStatus.Pending:
      return <Loader2 className='size-4 text-yellow-500 animate-pulse' />
    case NodeRunningStatus.Paused:
      return <Clock className='size-4 text-orange-500' />
    case NodeRunningStatus.Stopped:
      return <AlertCircle className='size-4 text-orange-500' />
    case NodeRunningStatus.Skipped:
      return <CheckCircle className='size-4 text-muted-foreground' />
    default:
      return null
  }
}
/**
 * Card component showing details of a single node execution
 */
export function NodeExecutionCard({ execution, workflowStatus, children }: NodeExecutionCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [activeTab, setActiveTab] = useState<'outputs' | 'inputs' | 'process' | 'metadata'>(
    'outputs'
  )
  const outputsCopy = useCopy({ toastMessage: 'Outputs copied to clipboard' })
  const inputsCopy = useCopy({ toastMessage: 'Inputs copied to clipboard' })

  // Get node icon from registry
  const nodeIcon = unifiedNodeRegistry.getNodeIcon(execution.nodeType, 'h-4 w-4')
  const nodeColor = unifiedNodeRegistry.getColor(execution.nodeType)
  // Extract metadata
  const metadata = execution.executionMetadata as any
  const totalTokens = metadata?.totalTokens
  const totalPrice = metadata?.totalPrice

  // Compute display status based on workflow state
  const displayStatus = computeDisplayStatus(execution.status, workflowStatus, !!execution.error)

  const showChildren = expanded && displayStatus !== NodeRunningStatus.Pending
  return (
    <div
      className={cn(
        'group/node node-execution-card  rounded-lg  bg-background relative',
        // displayStatus === NodeRunningStatus.Failed && 'border-destructive/20 ',
        // displayStatus === NodeRunningStatus.Running && 'border-blue-500/50 ',
        displayStatus === NodeRunningStatus.Pending && 'opacity-30'
      )}>
      <div
        className={cn(
          'absolute inset-0 pointer-events-none border rounded-lg ',
          displayStatus === NodeRunningStatus.Failed && 'border-destructive/20 bg-destructive/5',
          displayStatus === NodeRunningStatus.Succeeded && 'border-good-400/50',
          displayStatus === NodeRunningStatus.Running &&
            'border-blue-500/50 animate-pulse transition-all duration-400',
          displayStatus === NodeRunningStatus.Pending && 'border-muted/50',
          displayStatus === NodeRunningStatus.Paused && 'border-orange-500/50',
          displayStatus === NodeRunningStatus.Stopped && 'border-orange-500/30 bg-orange-500/5',
          displayStatus === NodeRunningStatus.Skipped && 'border-muted/30 bg-muted/5'
        )}></div>
      <div
        className='cursor-pointer py-0 hover:bg-muted/50 transition-colors pe-2'
        onClick={() => setExpanded(!expanded)}>
        <div className='flex items-center justify-between'>
          <div className='flex items-center'>
            <Button variant='ghost' size='icon-sm' className=''>
              <ChevronRight
                className={cn(
                  'text-primary-200 transition-transform duration-200 group-hover/node:text-primary-400',
                  showChildren && 'rotate-90'
                )}
              />
            </Button>

            <div
              className='flex size-6 items-center justify-center rounded-lg me-2'
              style={{ backgroundColor: `${nodeColor}20` }}>
              <div style={{ color: nodeColor }}>{nodeIcon}</div>
            </div>
            <div className='text-sm font-medium'>{execution.title}</div>
          </div>

          <div className='flex items-center gap-3'>
            {/* <p className="text-sm text-muted-foreground">Step {execution.index + 1}</p> */}

            {/* Token count if available */}
            {totalTokens && (
              <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                <Hash className='size-3' />
                {formatTokens(totalTokens)}
              </div>
            )}

            {/* Execution time */}
            <div className='flex items-center gap-1 text-xs text-muted-foreground'>
              <Clock className='size-3' />
              {formatTime(execution.elapsedTime)}
            </div>

            {/* Cost if available */}
            {totalPrice && (
              <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                <Coins className='size-3' />${totalPrice.toFixed(4)}
              </div>
            )}
            {getStatusIcon(displayStatus)}
          </div>
        </div>
      </div>

      <div
        className={cn(
          'overflow-hidden transition-all duration-200',
          showChildren ? '' : 'max-h-0'
        )}>
        <div className='p-2'>
          <RadioTab
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as 'outputs' | 'inputs' | 'metadata')}
            size='sm'
            radioGroupClassName='grid w-full grid-cols-3 after:rounded-2xl'
            className='border border-primary-50 h-8 w-full rounded-2xl'>
            <RadioTabItem value='outputs' size='sm' className='gap-1'>
              <FileOutput className='size-3.5!' />
              Outputs
            </RadioTabItem>
            <RadioTabItem value='inputs' size='sm' className='gap-1'>
              <FileInput className='size-3.5!' />
              Inputs
            </RadioTabItem>
            <RadioTabItem value='metadata' size='sm' className='gap-1'>
              <FileText className='size-3.5!' />
              Metadata
            </RadioTabItem>
          </RadioTab>

          {activeTab === 'outputs' && (
            <div className='mt-3'>
              {execution.outputs && (
                <div className='relative group'>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground size-7'
                    onClick={() => outputsCopy.copy(JSON.stringify(execution.outputs, null, 2))}
                    aria-label='Copy outputs'>
                    {outputsCopy.copied ? (
                      <Check className='h-3.5 w-3.5' />
                    ) : (
                      <Copy className='h-3.5 w-3.5' />
                    )}
                  </Button>
                  <pre className='p-3 bg-muted rounded-md text-xs overflow-auto max-h-[300px] font-mono'>
                    {JSON.stringify(execution.outputs, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {activeTab === 'inputs' && (
            <div className='mt-3'>
              {execution.inputs ? (
                <div className='relative group'>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground size-7'
                    onClick={() => inputsCopy.copy(JSON.stringify(execution.inputs, null, 2))}
                    aria-label='Copy inputs'>
                    {inputsCopy.copied ? (
                      <Check className='h-3.5 w-3.5' />
                    ) : (
                      <Copy className='h-3.5 w-3.5' />
                    )}
                  </Button>
                  <pre className='p-3 bg-muted rounded-md text-xs overflow-auto max-h-[300px] font-mono'>
                    {JSON.stringify(execution.inputs, null, 2)}
                  </pre>
                </div>
              ) : (
                <p className='text-sm text-muted-foreground py-8 text-center'>No inputs provided</p>
              )}
            </div>
          )}

          {activeTab === 'metadata' && (
            <div className='mt-3'>
              <div className='space-y-3 text-sm'>
                <div className='grid grid-cols-2 gap-x-4 gap-y-2'>
                  <div>
                    <span className='text-muted-foreground'>Node ID</span>
                    <p className='font-mono text-xs mt-0.5'>{execution.nodeId}</p>
                  </div>

                  {execution.predecessorNodeId && (
                    <div>
                      <span className='text-muted-foreground'>Previous Node</span>
                      <p className='font-mono text-xs mt-0.5'>{execution.predecessorNodeId}</p>
                    </div>
                  )}

                  <div>
                    <span className='text-muted-foreground'>Started At</span>
                    <p className='text-xs mt-0.5'>
                      {new Date(execution.createdAt).toLocaleString()}
                    </p>
                  </div>

                  {execution.finishedAt && (
                    <div>
                      <span className='text-muted-foreground'>Completed At</span>
                      <p className='text-xs mt-0.5'>
                        {new Date(execution.finishedAt).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>

                {/* AI-specific metadata */}
                {metadata &&
                  (metadata.promptTokens || metadata.completionTokens || metadata.model) && (
                    <div className='border-t pt-3 mt-3'>
                      <p className='text-muted-foreground mb-2 font-medium'>AI Execution Details</p>
                      <div className='grid grid-cols-2 gap-x-4 gap-y-2'>
                        {metadata.model && (
                          <div>
                            <span className='text-muted-foreground'>Model</span>
                            <p className='text-xs mt-0.5'>{metadata.model}</p>
                          </div>
                        )}
                        {metadata.promptTokens && (
                          <div>
                            <span className='text-muted-foreground'>Prompt Tokens</span>
                            <p className='text-xs mt-0.5'>{formatTokens(metadata.promptTokens)}</p>
                          </div>
                        )}
                        {metadata.completionTokens && (
                          <div>
                            <span className='text-muted-foreground'>Completion Tokens</span>
                            <p className='text-xs mt-0.5'>
                              {formatTokens(metadata.completionTokens)}
                            </p>
                          </div>
                        )}
                        {metadata.temperature !== undefined && (
                          <div>
                            <span className='text-muted-foreground'>Temperature</span>
                            <p className='text-xs mt-0.5'>{metadata.temperature}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                {/* Raw metadata if there's more */}
                {metadata && Object.keys(metadata).length > 0 && (
                  <div className='border-t pt-3 mt-3'>
                    <p className='text-muted-foreground mb-2'>Raw Metadata</p>
                    <pre className='p-2 bg-muted rounded text-xs overflow-auto max-h-[150px] font-mono'>
                      {JSON.stringify(metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error details */}
          {execution.error && (
            <Alert variant='destructive' className='mt-3'>
              <AlertCircle />
              <AlertDescription className='mt-1'>
                <p className='font-medium'>Execution Error</p>
                <p className='text-sm mt-1'>{execution.error}</p>
              </AlertDescription>
            </Alert>
          )}

          {/* Render children if provided (for loop iterations) */}
          {children && <div className='mt-3 border-t pt-3'>{children}</div>}
        </div>
      </div>
    </div>
  )
}
