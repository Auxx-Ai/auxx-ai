// apps/web/src/components/workflow/ui/workflow-checklist.tsx

import React, { memo, useState, useCallback } from 'react'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { ListTodo, AlertTriangle, AlertCircle } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { useChecklist } from '~/components/workflow/hooks'
import { useNodesInteractions } from '../hooks/use-node-interactions'
import { getIcon } from '../utils/icon-helper'
import { pluralize } from '@auxx/lib/utils'

import { Tooltip } from '~/components/global/tooltip'

interface WorkflowChecklistProps {
  className?: string
}

/**
 * WorkflowChecklist component displays validation warnings and issues
 */
export const WorkflowChecklist = memo<WorkflowChecklistProps>(({ className }) => {
  const [open, setOpen] = useState(false)
  const { nodesWithIssues, warningCount, errorCount, totalIssues } = useChecklist()
  const { handleNodeSelect } = useNodesInteractions()

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      // Don't try to select system warnings
      if (nodeId === 'trigger-missing') {
        return
      }

      // Select the node and close popover
      handleNodeSelect(nodeId)
      setOpen(false)
    },
    [handleNodeSelect]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="shrink-0">
          <Tooltip content="Workflow Issues" side="bottom">
            <Button
              size="icon-sm"
              variant="ghost"
              className={cn(
                'relative text-bad-500 border border-transparent hover:bg-bad-50 hover:border-bad-200 hover:text-bad-600',
                className
              )}
              title={`Workflow Issues (${totalIssues})`}>
              <ListTodo />
              {totalIssues > 0 && (
                <div
                  className={cn(
                    'absolute -right-2.5 -top-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-full border border-black/10 text-[9px] font-semibold text-white',
                    errorCount > 0 ? 'bg-bad-500 dark:bg-bad-300' : 'bg-orange-500'
                  )}>
                  {totalIssues}
                </div>
              )}
            </Button>
          </Tooltip>
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0 max-h-[400px] overflow-y-auto backdrop-blur-sm bg-white/40 dark:bg-white/5"
        align="end">
        <div className="border-b px-3 py-1 sticky top-0 backdrop-blur-sm dark:bg-black/40 bg-white/40 z-1">
          <h3 className="font-medium text-sm">Workflow Issues</h3>
          <p className="text-xs text-muted-foreground">
            {totalIssues === 0
              ? 'No issues found'
              : errorCount > 0 && warningCount > 0
                ? `${errorCount} ${pluralize(errorCount, 'error')}, ${warningCount} ${pluralize(warningCount, 'warning')}`
                : errorCount > 0
                  ? `${errorCount} ${pluralize(errorCount, 'error')}`
                  : `${warningCount} ${pluralize(warningCount, 'warning')}`}
          </p>
        </div>

        {totalIssues > 0 && (
          <div className="px-2 py-2">
            {nodesWithIssues.map((node) => (
              <div
                key={node.id}
                className={cn(
                  'mb-2 rounded-lg border-[0.5px] border-border bg-secondary/30 shadow-xs last-of-type:mb-0',
                  'cursor-pointer hover:bg-secondary/50 hover:ring-1 hover:ring-blue-500'
                )}
                onClick={() => handleNodeClick(node.id)}>
                <div className="flex h-9 items-center p-2 text-xs font-medium text-muted-foreground bg-primary-150/50 rounded-t-lg">
                  <span style={{ color: node.color }}>
                    {node.icon && getIcon(node.icon, 'mr-1.5 size-4')}
                  </span>
                  <span className="grow truncate">{node.title}</span>
                </div>
                {node.issues.map((issue, index) => (
                  <div
                    key={index}
                    className="px-3 py-2 border-t-[0.5px] border-border last:rounded-b-lg">
                    <div className="flex text-xs leading-[18px] text-muted-foreground">
                      {issue.severity === 'error' ? (
                        <AlertCircle className="mr-2 mt-[3px] h-3 w-3 text-bad-500" />
                      ) : (
                        <AlertTriangle className="mr-2 mt-[3px] h-3 w-3 text-[#F79009]" />
                      )}
                      {issue.message || 'This node is not connected to any other nodes.'}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {totalIssues === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <ListTodo className="h-8 w-8 mx-auto mb-2 opacity-50" />
            All workflow validations passed
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
})

WorkflowChecklist.displayName = 'WorkflowChecklist'
