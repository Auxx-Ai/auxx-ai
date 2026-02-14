// apps/web/src/components/workflow/nodes/core/manual/panel.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import React, { useCallback } from 'react'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { useNodeAddition } from '~/components/workflow/hooks/use-node-addition'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import Section from '~/components/workflow/ui/section'
import { BasePanel } from '../../shared/base/base-panel'
import { ConnectedInputsEditor } from './connected-inputs-editor'
import { manualDefinition } from './schema'
import type { ManualNodeData } from './types'

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
  const { addNode, selectNewNode } = useNodeAddition()

  /** Directly add a form-input node connected to this manual trigger */
  const handleAddInput = useCallback(async () => {
    const newNodeId = await addNode({
      nodeType: 'form-input',
      position: 'before',
      anchorNode: { id: nodeId, targetHandle: 'input' },
    })
    selectNewNode(newNodeId)
  }, [addNode, selectNewNode, nodeId])

  // Add button for Section actions
  const AddInputButton = (
    <Button variant='ghost' size='xs' disabled={isReadOnly} onClick={handleAddInput}>
      <Plus />
      Add
    </Button>
  )

  return (
    <BasePanel nodeId={nodeId} data={data}>
      {/* Connected Input Nodes */}
      <Section
        title='Connected Inputs'
        description='Form input nodes connected to this manual trigger.'
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
