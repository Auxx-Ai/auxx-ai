// apps/web/src/components/workflow/nodes/core/loop/panel.tsx

'use client'

import React, { useCallback, memo } from 'react'
import { type LoopNodeData } from './types'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import { Label } from '@auxx/ui/components/label'
import { Switch } from '@auxx/ui/components/switch'
import Section from '~/components/workflow/ui/section'
import { VarEditor, VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables/output-variables-display'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { LOOP_CONSTANTS } from './constants'
import { InfoIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { loopDefinition } from './schema'
import { BaseType } from '../if-else'
import { VAR_MODE } from '~/components/workflow/types'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
} from '@auxx/ui/components/input-group'
import {
  NumberInput,
  NumberInputField,
  NumberInputScrubber,
  NumberInputIncrement,
  NumberInputDecrement,
} from '@auxx/ui/components/input-number'

interface LoopPanelProps {
  nodeId: string
  data: LoopNodeData
}

/**
 * Configuration panel for the Loop node
 */
const LoopPanelComponent: React.FC<LoopPanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()
  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<LoopNodeData>(nodeId, data)

  // Handle items source change
  const handleItemsSourceChange = useCallback(
    (value: string) => {
      setNodeData({ ...nodeData, itemsSource: value })
    },
    [nodeData, setNodeData]
  )

  // Iterator name removed - always 'item' now

  // Handle max iterations change
  const handleMaxIterationsChange = useCallback(
    (value: number | undefined) => {
      if (value !== undefined && value > 0) {
        setNodeData({ ...nodeData, maxIterations: value })
      }
    },
    [nodeData, setNodeData]
  )

  // Handle accumulate results change
  const handleAccumulateResultsChange = useCallback(
    (checked: boolean) => {
      setNodeData({ ...nodeData, accumulateResults: checked })
    },
    [nodeData, setNodeData]
  )

  if (!nodeData) return null

  return (
    <BasePanel nodeId={nodeId} data={data}>
      {/* Items Source Configuration */}
      <Section
        title="Items to Loop Over"
        description="Select an array or list variable to iterate through"
        isRequired>
        <VarEditorField>
          <VarEditor
            value={nodeData.itemsSource || ''}
            onChange={handleItemsSourceChange}
            varType={BaseType.ARRAY}
            nodeId={nodeId}
            mode={VAR_MODE.PICKER}
            placeholder="Pick an array variable..."
            disabled={isReadOnly}
          />
        </VarEditorField>
        <p className="text-xs text-muted-foreground mt-1">
          The loop will iterate over each item in this array
        </p>
      </Section>

      {/* Maximum Iterations */}
      <Section title="Maximum Iterations" description="Safety limit to prevent infinite loops">
        <div className="space-y-2">
          <NumberInput
            value={nodeData.maxIterations || LOOP_CONSTANTS.DEFAULT_MAX_ITERATIONS}
            onValueChange={handleMaxIterationsChange}
            min={1}
            max={LOOP_CONSTANTS.ABSOLUTE_MAX_ITERATIONS}
            step={1}
            disabled={isReadOnly}>
            <div className="flex flex-col items-start">
              <NumberInputScrubber htmlFor="max-iterations" className="mb-1">
                Maximum Iterations
              </NumberInputScrubber>
              <InputGroup>
                <InputGroupAddon align="inline-start">
                  <NumberInputDecrement />
                </InputGroupAddon>
                <NumberInputField
                  id="max-iterations"
                  placeholder={LOOP_CONSTANTS.DEFAULT_MAX_ITERATIONS.toString()}
                />
                <InputGroupAddon align="inline-end">
                  <NumberInputIncrement />
                  <InputGroupText>iterations</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </div>
          </NumberInput>
          <Alert>
            <InfoIcon className="h-4 w-4" />
            <AlertDescription>
              The loop will stop after{' '}
              {nodeData.maxIterations || LOOP_CONSTANTS.DEFAULT_MAX_ITERATIONS} iterations, even if
              there are more items. Maximum allowed: {LOOP_CONSTANTS.ABSOLUTE_MAX_ITERATIONS}.
            </AlertDescription>
          </Alert>
        </div>
      </Section>

      {/* Output Variables */}
      <OutputVariablesDisplay
        outputVariables={loopDefinition.outputVariables(nodeData, nodeId)}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const LoopPanel = memo(LoopPanelComponent)
