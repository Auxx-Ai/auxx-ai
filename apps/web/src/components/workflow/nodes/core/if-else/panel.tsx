// apps/web/src/components/workflow/nodes/core/if-else/panel.tsx

import React, { memo, useCallback, useRef } from 'react'
import { type IfElseNodeData } from './types'
import { BasePanel } from '../../shared/base/base-panel'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { OutputVariablesDisplay } from '../../../ui/output-variables'
import { ifElseDefinition } from './schema'
import { ConditionProvider, ConditionContainer } from '~/components/workflow/ui/conditions'
import { useIfElseConditionAdapter } from './adapters/condition-adapter'
import { useAvailableVariables } from '~/components/workflow/hooks'
import { parseVariable } from '~/components/workflow/utils/variable-utils'

interface IfElsePanelProps {
  nodeId: string
  data: IfElseNodeData
}

const IfElsePanelComponent: React.FC<IfElsePanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()

  // Use the new crud hook for efficient updates with flattened data
  const { inputs, setInputs } = useNodeCrud<IfElseNodeData>(nodeId, data)

  // Get available variables for the node
  const { allVariables } = useAvailableVariables({
    nodeId,
    includeEnvironment: true,
    includeSystem: true,
  })

  // Use the modern condition adapter
  const { groups, onGroupsChange, config } = useIfElseConditionAdapter({
    nodeId,
    data: inputs,
    setInputs,
    readOnly: isReadOnly,
  })

  // Store allVariables in a ref to create a stable callback that doesn't cause re-renders
  // The callback will always access the latest allVariables via the ref
  const allVariablesRef = useRef(allVariables)
  allVariablesRef.current = allVariables

  // Create stable field definition getter that doesn't change reference
  const getFieldDefinition = useCallback((fieldId: string) => {
    const variable = allVariablesRef.current.find((v) => v.id === fieldId)
    if (!variable) return undefined

    // Use unified parseVariable function that handles all the type detection and metadata
    return parseVariable(variable)
  }, [])

  return (
    <BasePanel title="IF/ELSE Configuration" nodeId={nodeId} data={data} showNextStep={true}>
      <ConditionProvider
        conditions={[]}
        groups={groups}
        config={config}
        onConditionsChange={() => {}}
        onGroupsChange={onGroupsChange}
        nodeId={nodeId}
        readOnly={isReadOnly}
        getFieldDefinition={getFieldDefinition}>
        <div className="p-3 pe-1 relative">
          <ConditionContainer
            showGrouping
            showAddButton
            emptyStateText="No cases - click 'Add Case' to start"
          />
        </div>
      </ConditionProvider>
      {/* <IfElseProvider nodeId={nodeId} data={inputs} setInputs={setInputs} readOnly={isReadOnly}>
        <ConditionWrap cases={inputs.cases} />
      </IfElseProvider> */}

      <OutputVariablesDisplay
        outputVariables={ifElseDefinition.outputVariables?.(data, nodeId) || []}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const IfElsePanel = memo(IfElsePanelComponent)
