// apps/web/src/components/workflow/nodes/inputs/text-input/panel.tsx

'use client'

import React from 'react'
import { TextInputNodeData } from './types'
import { BasePanel } from '../../shared/base/base-panel'
import { Input } from '@auxx/ui/components/input'
import { Textarea } from '@auxx/ui/components/textarea'
import { Label } from '@auxx/ui/components/label'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import Section from '~/components/workflow/ui/section'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import { textInputDefinition } from './schema'

interface TextInputPanelProps {
  nodeId: string
  data: TextInputNodeData
}

/**
 * Configuration panel for text input node
 */
const TextInputPanelComponent: React.FC<TextInputPanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()
  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<TextInputNodeData>(nodeId, data)

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNodeData({ ...nodeData, label: e.target.value })
  }

  const handlePlaceholderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNodeData({ ...nodeData, placeholder: e.target.value })
  }

  const handleDefaultValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNodeData({ ...nodeData, defaultValue: e.target.value })
  }

  const handleRequiredChange = (checked: boolean) => {
    setNodeData({ ...nodeData, required: checked })
  }

  return (
    <BasePanel nodeId={nodeId} data={data}>
      {/* Input Field Configuration */}
      <Section
        title="Text Input Configuration"
        description="Configure the text input field settings."
        isRequired>
        <div className="space-y-4">
          <div>
            <Label htmlFor="label">Field Label</Label>
            <Input
              id="label"
              value={nodeData.label || ''}
              onChange={handleLabelChange}
              disabled={isReadOnly}
              placeholder="Enter the label for this input field"
            />
          </div>

          <div>
            <Label htmlFor="placeholder">Placeholder</Label>
            <Input
              id="placeholder"
              value={nodeData.placeholder || ''}
              onChange={handlePlaceholderChange}
              disabled={isReadOnly}
              placeholder="Optional placeholder text"
            />
          </div>

          <div>
            <Label htmlFor="defaultValue">Default Value</Label>
            <Input
              id="defaultValue"
              value={nodeData.defaultValue || ''}
              onChange={handleDefaultValueChange}
              disabled={isReadOnly}
              placeholder="Optional default value"
            />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="required"
              checked={nodeData.required || false}
              onCheckedChange={handleRequiredChange}
              disabled={isReadOnly}
            />
            <Label htmlFor="required">Required field</Label>
          </div>
        </div>
      </Section>

      {/* Available Variables */}
      <OutputVariablesDisplay
        outputVariables={textInputDefinition.outputVariables?.(nodeData, nodeId) || []}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const TextInputPanel = React.memo(TextInputPanelComponent)
