// apps/web/src/components/workflow/viewer/workflow-viewer-operators.tsx

'use client'

import React, { memo } from 'react'
import { Button } from '@auxx/ui/components/button'
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import { cn } from '@auxx/ui/lib/utils'
import { Tooltip } from '~/components/global/tooltip'

/**
 * Props for WorkflowViewerOperators component
 */
interface WorkflowViewerOperatorsProps {
  className?: string
  onZoomIn: () => void
  onZoomOut: () => void
  onFitView: () => void
}

/**
 * Minimal operators for the workflow viewer
 * Only zoom/pan controls - no editing features
 */
export const WorkflowViewerOperators = memo<WorkflowViewerOperatorsProps>(
  ({ className, onZoomIn, onZoomOut, onFitView }) => {
    return (
      <div className={cn('workflow-viewer-operators flex flex-row gap-2', className)}>
        {/* Zoom controls */}
        <div className="flex items-center gap-0.5 p-0.5 bg-white/40 dark:bg-white/10 backdrop-blur-sm rounded-lg ring-black/5 ring-1">
          <Tooltip content="Zoom In">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onZoomIn}
              className="hover:dark:bg-white/15">
              <ZoomIn />
            </Button>
          </Tooltip>
          <Tooltip content="Zoom Out">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onZoomOut}
              className="hover:dark:bg-white/15">
              <ZoomOut />
            </Button>
          </Tooltip>
          <Tooltip content="Fit View">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onFitView}
              className="hover:dark:bg-white/15">
              <Maximize />
            </Button>
          </Tooltip>
        </div>
      </div>
    )
  }
)

WorkflowViewerOperators.displayName = 'WorkflowViewerOperators'
