// apps/web/src/components/workflow/nodes/core/list/panel.tsx

'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { produce } from 'immer'
import type React from 'react'
import { memo, useCallback, useMemo } from 'react'
import { v4 as generateId } from 'uuid'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { useVariable } from '~/components/workflow/hooks/use-var-store-sync'
import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'
import { BaseType, VAR_MODE } from '~/components/workflow/types'
import Field from '~/components/workflow/ui/field'
import { VarEditor, VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import Section from '~/components/workflow/ui/section'

// Import operation-specific components
import { FilterPanel } from './components/filter-panel'
// import { UniquePanel } from './components/unique-panel'
import { JoinPanel } from './components/join-panel'
import { PluckPanel } from './components/pluck-panel'
import { SlicePanel } from './components/slice-panel'
import { SortPanel } from './components/sort-panel'
import { computeListOutputVariables } from './output-variables'
import { type ListNodeData, type ListOperation, OPERATION_METADATA } from './types'

interface ListPanelProps {
  nodeId: string
  data: ListNodeData
}

/**
 * Configuration panel for the List Operations node
 */
const ListPanelComponent: React.FC<ListPanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()
  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<ListNodeData>(nodeId, data)

  // Extract variable ID from inputList (format: "{{variableId}}" or "variableId")
  const inputVariableId = useMemo(() => {
    if (!nodeData?.inputList) return undefined
    return nodeData.inputList.replace(/[{}]/g, '')
  }, [nodeData?.inputList])

  // Get the input array variable using the hook
  const { variable: inputArrayVariable } = useVariable(inputVariableId, nodeId)

  // Compute output variables with proper memoization
  const outputVariables = useMemo(() => {
    if (!nodeData) return []

    // Pass only the specific input variable we need
    return computeListOutputVariables(nodeData, nodeId, inputArrayVariable)
  }, [
    nodeData?.operation,
    nodeData?.inputList,
    nodeData?.sliceConfig?.mode,
    nodeData?.sliceConfig?.count,
    nodeData?.pluckConfig?.field,
    nodeData?.pluckConfig?.flatten,
    nodeData?.joinConfig?.delimiter,
    nodeData?.joinConfig?.field,
    inputArrayVariable,
    nodeId,
  ])

  // Handle operation change
  const handleOperationChange = useCallback(
    (operation: ListOperation) => {
      if (!nodeData) return

      // Use immer to create a new data with the operation change
      const newData = produce(nodeData, (draft) => {
        // Update operation
        draft.operation = operation

        // Reset all operation-specific configs
        draft.filterConfig = undefined
        draft.sortConfig = undefined
        draft.sliceConfig = undefined
        // draft.uniqueConfig = undefined
        draft.joinConfig = undefined
        draft.pluckConfig = undefined

        // Set default config for new operation
        switch (operation) {
          case 'filter':
            draft.filterConfig = {
              conditions: [
                {
                  id: generateId(),
                  fieldId: '',
                  operator: 'is',
                  value: '',
                  isConstant: true,
                },
              ],
            }
            break
          case 'sort':
            // No default config - user must select a field
            break
          case 'slice':
            draft.sliceConfig = { mode: 'first', count: 10 }
            break
          // case 'unique':
          //   draft.uniqueConfig = { by: 'whole', keepFirst: true }
          //   break
          case 'join':
            draft.joinConfig = { delimiter: ', ' }
            break
          case 'pluck':
            draft.pluckConfig = { field: '', flatten: false }
            break
        }
      })

      // Update data using setNodeData
      setNodeData(newData)
    },
    [nodeData, setNodeData]
  )

  // Handle input list change
  const handleInputListChange = useCallback(
    (value: string | any) => {
      // VarEditor can return either string or TiptapJSON, but we want to store as string
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
      setNodeData({ ...nodeData, inputList: stringValue })
    },
    [nodeData, setNodeData]
  )

  // Prepare operation options for EnumInput
  const operationOptions = Object.entries(OPERATION_METADATA).map(([value, metadata]) => ({
    value,
    label: metadata.label,
    description: metadata.description,
    icon: metadata.icon,
  }))

  // Create onChange handler for sub-panels
  const handleSubPanelChange = useCallback(
    (updates: Partial<ListNodeData>) => {
      setNodeData({ ...nodeData, ...updates })
    },
    [nodeData, setNodeData]
  )

  // Render operation-specific panel
  const renderOperationPanel = () => {
    if (!nodeData) return null

    const commonProps = {
      config: nodeData,
      onChange: handleSubPanelChange,
      isReadOnly,
      nodeId,
    }

    switch (nodeData.operation) {
      case 'filter':
        return <FilterPanel {...commonProps} />
      case 'sort':
        return <SortPanel {...commonProps} />
      case 'slice':
        return <SlicePanel {...commonProps} />
      // case 'unique':
      //   return <UniquePanel {...commonProps} />
      case 'join':
        return <JoinPanel {...commonProps} />
      case 'pluck':
        return <PluckPanel {...commonProps} />
      case 'reverse':
        // Reverse operation has no additional configuration
        return (
          <div className='text-sm text-muted-foreground'>
            This operation reverses the order of items in the list. No additional configuration
            needed.
          </div>
        )
      default:
        return null
    }
  }

  // Memoize metadata lookup to avoid re-creating on every render
  const metadata = useMemo(() => OPERATION_METADATA[nodeData.operation], [nodeData.operation])

  return (
    <BasePanel nodeId={nodeId} data={data}>
      {/* Operation Selection */}
      <Section
        title='Operation'
        description='Select the operation to perform on the list'
        isRequired
        actions={
          <Select
            value={nodeData.operation}
            onValueChange={handleOperationChange}
            disabled={isReadOnly}>
            <SelectTrigger size='sm'>
              <SelectValue>
                {OPERATION_METADATA[nodeData.operation]?.label || nodeData.operation}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {operationOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <div>
                    <div className='font-medium'>{option.label}</div>
                    {option.description && (
                      <div className='text-xs text-muted-foreground'>{option.description}</div>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }>
        <div className='space-y-2'>
          <Field title='Input List' description='Select or enter the list variable to operate on'>
            <VarEditorField>
              <VarEditor
                placeholder='Select or enter a list variable'
                varType={BaseType.ARRAY}
                value={nodeData.inputList}
                onChange={handleInputListChange}
                nodeId={nodeId}
                mode={VAR_MODE.PICKER}
              />
            </VarEditorField>
          </Field>
          <Field
            title={`${metadata?.label ?? 'Unknown'} Configuration`}
            description={`Configure the ${metadata?.label?.toLowerCase() ?? 'unknown'} operation`}>
            {renderOperationPanel()}
          </Field>
        </div>
      </Section>

      {/* Output Variables */}
      <OutputVariablesDisplay outputVariables={outputVariables} initialOpen={false} />
    </BasePanel>
  )
}

export const ListPanel = memo(ListPanelComponent)
