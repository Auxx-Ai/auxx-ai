// apps/web/src/components/workflow/nodes/core/var-assign/panel.tsx

'use client'

import React, { useCallback, memo, useState } from 'react'
import type { VariableAssignment, VarAssignNodeData } from './types'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import Section from '~/components/workflow/ui/section'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { VarAssignList } from './components/var-assign-list'
import { varAssignDefinition } from './schema'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import { Plus } from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { BaseType } from '~/components/workflow/types'
import { Button } from '@auxx/ui/components/button'
interface VarAssignPanelProps {
  nodeId: string
  data: VarAssignNodeData
}

/**
 * Configuration panel for the Variable Assignment node
 */
const VarAssignPanelComponent: React.FC<VarAssignPanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()
  const [isOpen, setIsOpen] = useState(true)

  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<VarAssignNodeData>(nodeId, data)
  // const { variables, groups } = useAvailableVariables({ nodeId })

  // Handle ignore type error toggle
  const handleIgnoreTypeErrorChange = useCallback(
    (checked: boolean) => {
      setNodeData({ ...nodeData, ignoreTypeError: checked })
    },
    [nodeData, setNodeData]
  )

  const handleAddAssignment = useCallback(() => {
    // Open section if it's closed
    if (!isOpen) setIsOpen(true)

    const newAssignment: VariableAssignment = {
      id: uuidv4(),
      name: '',
      type: BaseType.STRING,
      value: '',
    }
    setNodeData({ ...nodeData, variables: [...(nodeData.variables || []), newAssignment] })
  }, [isOpen, nodeData, setNodeData])

  const handleVariablesChange = useCallback(
    (variables: VariableAssignment[]) => {
      console.log('Variables changed:', variables)
      setNodeData({ ...nodeData, variables })
    },
    [nodeData, setNodeData]
  )

  if (!nodeData) return null
  return (
    <BasePanel nodeId={nodeId} data={data}>
      {/* Variable Assignments Section */}
      <Section
        title="Variable Assignments"
        description="Define variables to create and their values"
        isRequired
        open={isOpen}
        onOpenChange={setIsOpen}
        actions={
          <Button variant="ghost" size="xs" onClick={handleAddAssignment} disabled={isReadOnly}>
            <Plus /> Add
          </Button>
        }>
        <VarAssignList
          assignments={nodeData.variables || []}
          onChange={handleVariablesChange}
          nodeId={nodeId}
          readOnly={isReadOnly}
          onAdd={handleAddAssignment}
        />
      </Section>

      {/* Advanced Settings Section */}
      <Section
        title="Advanced Settings"
        description="Additional configuration options"
        initialOpen={false}>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="ignoreTypeError" className="text-sm">
              Ignore Type Errors
              <span className="block text-xs text-muted-foreground mt-1">
                Continue execution even if type conversion fails
              </span>
            </Label>
            <Switch
              id="ignoreTypeError"
              size="sm"
              checked={nodeData.ignoreTypeError || false}
              onCheckedChange={handleIgnoreTypeErrorChange}
              disabled={isReadOnly}
            />
          </div>
        </div>
      </Section>
      <OutputVariablesDisplay
        outputVariables={varAssignDefinition.outputVariables?.(nodeData, nodeId) || []}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const VarAssignPanel = memo(VarAssignPanelComponent)
