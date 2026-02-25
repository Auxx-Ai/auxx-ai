// apps/web/src/components/workflow/nodes/shared/single-run-result-tab.tsx

import type { WorkflowNodeExecutionEntity as WorkflowNodeExecution } from '@auxx/database/types'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { AlertCircle, CheckCircle2, Clock, Play, XCircle } from 'lucide-react'
import { memo } from 'react'
import CodeEditor, { CodeLanguage } from '~/components/workflow/ui/code-editor'
import Section from '~/components/workflow/ui/section'
import { useRunSingleNode } from '../../hooks'
import { useRunStore } from '../../store/run-store'

export interface SingleRunResultTabProps {
  /** Node ID */
  nodeId: string
  /** Handler for running the node */
  onRun?: () => void
}

/**
 * Result tab for single node execution
 */
export const SingleRunResultTab = memo(function SingleRunResultTab({
  nodeId,
  onRun,
}: SingleRunResultTabProps) {
  // Get data from hooks inside the component
  const { result: runResult, isRunning } = useRunSingleNode(nodeId)
  const nodeExecution = useRunStore((state) => state.getNodeExecution(nodeId))

  // Use single data source - prefer nodeExecution from workflow runs, fallback to runResult from single runs
  const execution: WorkflowNodeExecution | undefined = nodeExecution || runResult || undefined
  // Extract data directly from WorkflowNodeExecution
  const outputData = execution?.outputs
  const inputData = execution?.inputs as Record<string, any>
  const processData = execution?.processData
  const nodeTitle = execution?.title
  const errorMessage = execution?.error
  const status = execution?.status

  // Extract timing metadata
  const metadata = {
    startTime: execution?.createdAt ? new Date(execution.createdAt).getTime() : undefined,
    endTime: execution?.finishedAt ? new Date(execution.finishedAt).getTime() : undefined,
    duration: execution?.elapsedTime ? execution.elapsedTime * 1000 : undefined,
    nodeType: execution?.nodeType,
  }

  // Loading state
  if (isRunning && !execution) {
    return (
      <div className='p-4'>
        <div className='space-y-4'>
          <Skeleton className='h-20 w-full' />
          <Skeleton className='h-40 w-full' />
        </div>
      </div>
    )
  }
  // Error state
  if (status === 'failed') {
    return (
      <div className='p-4'>
        <Alert variant='destructive'>
          <XCircle className='size-4' />
          <AlertTitle>Execution Failed</AlertTitle>
          <AlertDescription>{errorMessage || 'An unknown error occurred'}</AlertDescription>
        </Alert>
      </div>
    )
  }
  // No result yet
  if (!execution) {
    return (
      <div className='relative flex flex-1 w-full items-center justify-center'>
        <div className='flex flex-col items-center justify-center text-center p-8 pt-0'>
          <AlertCircle className='mb-2 size-8 text-muted-foreground' />
          <h3 className='text-medium mb-0'>No execution results yet.</h3>
          <div className='text-sm text-muted-foreground mb-2'>Run the node to see output.</div>
          <Button variant='outline' size='sm' onClick={onRun} disabled={isRunning || !onRun}>
            <Play />
            Run this node
          </Button>
        </div>
      </div>
    )
  }
  // Running state
  if (status === 'running') {
    return (
      <div>
        <div className='border-b'>
          <div className='flex flex-col space-y-1.5 p-3'>
            <div className='flex items-center justify-between'>
              <div className='font-semibold leading-none tracking-tight flex items-center gap-2'>
                <Clock className='size-5 animate-spin' />
                Executing Node
              </div>
              <Badge variant='secondary'>Running</Badge>
            </div>
            <div className='text-sm text-muted-foreground'>
              {nodeTitle || 'Node'} is being executed...
            </div>
          </div>
        </div>

        {/* Show input data while running */}
        {inputData && Object.keys(inputData).length > 0 && (
          <Section title='Input Data'>
            <CodeEditor
              value={JSON.stringify(inputData, null, 2)}
              language={CodeLanguage.json}
              readOnly={true}
              minHeight={120}
              title='INPUT'
              gradientBorder={false}
              downloadFilename={`node-${nodeId}-input-${Date.now()}.json`}
            />
          </Section>
        )}

        <div className='p-3'>
          <div className='space-y-2'>
            <p className='text-sm text-muted-foreground'>Waiting for output...</p>
            <Skeleton className='h-4 w-3/4' />
            <Skeleton className='h-4 w-1/2' />
            <Skeleton className='h-4 w-2/3' />
          </div>
        </div>
      </div>
    )
  }
  // Completed state
  return (
    <>
      {/* Status card */}
      <div className='border-b '>
        <div className='flex flex-col space-y-1.5 p-3'>
          <div className='flex items-center justify-between'>
            <div className='font-semibold leading-none tracking-tight flex items-center gap-2'>
              <CheckCircle2 className='size-5 text-green-600' />
              Execution Completed
            </div>
            <div className='flex items-center gap-2'>
              <Badge variant='green'>Success</Badge>
            </div>
          </div>
          <div className='text-sm text-muted-foreground'>
            {nodeTitle || 'Node'} executed successfully
          </div>
          {metadata && (metadata.startTime || metadata.duration) && (
            <div className='flex gap-4 text-sm text-muted-foreground'>
              {metadata.duration && <div>Duration: {metadata.duration}ms</div>}
              {metadata.startTime && (
                <div>Executed at: {new Date(metadata.startTime).toLocaleTimeString()}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Input data */}
      {inputData && Object.keys(inputData).length > 0 && (
        <Section initialOpen title='Input Data'>
          <CodeEditor
            value={JSON.stringify(inputData, null, 2)}
            language={CodeLanguage.json}
            readOnly={true}
            minHeight={120}
            title='INPUT'
            gradientBorder={false}
            downloadFilename={`node-${nodeId}-input-${Date.now()}.json`}
          />
        </Section>
      )}

      {/* Process details */}
      {processData && Object.keys(processData).length > 0 && (
        <Section initialOpen title='Process Details'>
          <CodeEditor
            value={JSON.stringify(processData, null, 2)}
            language={CodeLanguage.json}
            readOnly={true}
            minHeight={120}
            title='PROCESS'
            gradientBorder={false}
            downloadFilename={`node-${nodeId}-process-${Date.now()}.json`}
          />
        </Section>
      )}
      {/* Output data */}
      <Section initialOpen title='Output Data'>
        {outputData ? (
          <CodeEditor
            value={JSON.stringify(outputData, null, 2)}
            language={CodeLanguage.json}
            readOnly={true}
            minHeight={120}
            title='OUTPUT'
            gradientBorder={false}
            downloadFilename={`node-${nodeId}-output-${Date.now()}.json`}
          />
        ) : (
          <p className='text-sm text-muted-foreground'>No output data</p>
        )}
      </Section>
    </>
  )
})
