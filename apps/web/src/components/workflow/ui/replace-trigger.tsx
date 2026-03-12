// apps/web/src/components/workflow/ui/replace-trigger.tsx

import type { WorkflowTriggerType } from '@auxx/lib/workflow-engine/client'
import { Button } from '@auxx/ui/components/button'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTriggerDefinitions } from '../hooks'
import { AddNodeTrigger } from './add-node-trigger'

interface ReplaceTriggerProps {
  nodeId: string
  nodeType: WorkflowTriggerType
}

/**
 * Component to replace the current trigger node with a different type
 * Shows in trigger node panels to allow switching trigger types
 */
export function ReplaceTrigger({ nodeId, nodeType }: ReplaceTriggerProps) {
  const [open, setOpen] = useState(false)

  // Get all trigger node types (subscribes to registry changes)
  const triggerDefinitions = useTriggerDefinitions()
  const triggerTypes = triggerDefinitions.map((d) => d.id)

  const availableTriggerTypes = triggerTypes.filter((type) => {
    const def = triggerDefinitions.find((d) => d.id === type)
    return def?.triggerType !== nodeType
  })

  const handleNodeAdded = (newNodeId: string, nodeType: string) => {
    // Close the selector
    setOpen(false)
  }

  return (
    <div className='m-3 ps-3 pe-1 py-1 rounded-md border border-comparison-200 bg-comparison-100'>
      <div className='flex items-center justify-between'>
        <div>
          <p className='text-xs font-medium uppercase'>Trigger</p>
        </div>
        <AddNodeTrigger
          position='replace'
          replaceNodeId={nodeId}
          allowedNodeTypes={availableTriggerTypes}
          open={open}
          onOpenChange={setOpen}
          onNodeAdded={handleNodeAdded}>
          <Button variant='outline' size='sm' className='bg-comparison-200 hover:bg-comparison-300'>
            <RefreshCw />
            Replace
          </Button>
        </AddNodeTrigger>
      </div>
    </div>
  )
}
