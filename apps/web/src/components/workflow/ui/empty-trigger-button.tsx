// apps/web/src/components/workflow/ui/empty-trigger-button.tsx

import { Button } from '@auxx/ui/components/button'
import { Panel } from '@xyflow/react'
import { Plus } from 'lucide-react'
import { memo, useState } from 'react'
import { useTriggerDefinitions, useWorkflowTrigger } from '~/components/workflow/hooks'
import { AddNodeTrigger } from './add-node-trigger'

/**
 * Empty trigger button shown when workflow has no trigger
 * Displays in upper-left corner as a ReactFlow Panel
 */
export const EmptyTriggerButton = memo(function EmptyTriggerButton() {
  const { hasTrigger } = useWorkflowTrigger()

  // Always call hooks unconditionally (Rules of Hooks)
  const triggerTypes = useTriggerDefinitions().map((d) => d.id)
  const [open, setOpen] = useState(false)

  // Don't show if workflow already has a trigger
  if (hasTrigger) return null

  return (
    <div className='bg-background/50 backdrop-blur-sm border rounded-lg p-2'>
      {/* <p className="text-sm text-muted-foreground mb-2">Add</p> */}
      <AddNodeTrigger
        position='standalone'
        allowedNodeTypes={triggerTypes}
        open={open}
        onOpenChange={setOpen}
        onNodeAdded={() => setOpen(false)}>
        <Button variant='default' size='xs'>
          <Plus />
          Add Trigger
        </Button>
      </AddNodeTrigger>
    </div>
  )
})
