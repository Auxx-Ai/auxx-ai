// apps/web/src/components/workflow/nodes/core/manual/panel.tsx

'use client'

import React from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import type { ManualNodeData } from './types'
import { BasePanel } from '../../shared/base/base-panel'
import { useNodeCrud, useAvailableBlocks, useReadOnly } from '~/components/workflow/hooks'
import Section from '~/components/workflow/ui/section'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import { AddNodeTrigger } from '~/components/workflow/ui/add-node-trigger'
import { manualDefinition } from './schema'
import { ConnectedInputsEditor } from './connected-inputs-editor'

interface ManualPanelProps {
  nodeId: string
  data: ManualNodeData
}

/**
 * Configuration panel for manual trigger node
 */
const ManualPanelComponent: React.FC<ManualPanelProps> = ({ nodeId, data }) => {
  const { inputs: nodeData } = useNodeCrud<ManualNodeData>(nodeId, data)
  const { isReadOnly } = useReadOnly()
  const { availableNextBlocks } = useAvailableBlocks(data.type, data.isInLoop, 'input')

  // Create anchor node for AddNodeTrigger
  const anchorNode = {
    id: nodeId,
    type: data.type,
    position: { x: 0, y: 0 },
    data,
  }

  // Add button for Section actions
  const AddInputButton = (
    <AddNodeTrigger
      anchorNode={anchorNode}
      targetHandle="input"
      position="before"
      allowedNodeTypes={availableNextBlocks || ['form-input']}>
      <Button variant="ghost" size="xs" disabled={isReadOnly}>
        <Plus />
        Add
      </Button>
    </AddNodeTrigger>
  )

  return (
    <BasePanel nodeId={nodeId} data={data}>
      {/* Connected Input Nodes */}
      <Section
        title="Connected Inputs"
        description="Form input nodes connected to this manual trigger."
        initialOpen={true}
        actions={AddInputButton}>
        <ConnectedInputsEditor manualNodeId={nodeId} />
      </Section>

      {/* Available Variables */}
      <OutputVariablesDisplay
        outputVariables={manualDefinition.outputVariables?.(nodeData, nodeId) || []}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const ManualPanel = React.memo(ManualPanelComponent)
