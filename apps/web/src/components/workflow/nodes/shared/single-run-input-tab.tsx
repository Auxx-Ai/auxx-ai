// apps/web/src/components/workflow/nodes/shared/single-run-input-tab.tsx

import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { useStoreApi } from '@xyflow/react'
import { AlertCircle, Play } from 'lucide-react'
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BaseType, type FlowNode, type UnifiedVariable } from '~/components/workflow/types'
import Section from '~/components/workflow/ui/section'
import { getUpstreamNodeIds } from '~/components/workflow/utils/graph-utils'
import {
  getNodeIdFromVariableId,
  getVariableRelationship,
} from '~/components/workflow/utils/variable-utils'
import { useRunSingleNode } from '../../hooks'
import { useTestInputStore } from '../../store/test-input-store'
import { useVarStore } from '../../store/use-var-store'
import { useWorkflowStore } from '../../store/workflow-store'
import { getInputComponent } from '../../ui/input-editor/get-input-component'
import { VarEditorField, VarEditorFieldRow } from '../../ui/input-editor/var-editor'
import { unifiedNodeRegistry } from '../unified-registry'

export interface SingleRunInputTabProps {
  /** Node ID */
  nodeId: string
  /** Node configuration */
  data: FlowNode['data']
  /** Handler for running the node */
  onRun: () => void
}

/**
 * Input tab for single node execution
 */
export const SingleRunInputTab = memo(function SingleRunInputTab({
  nodeId,
  data,
  onRun,
}: SingleRunInputTabProps) {
  // Track if we've initialized to prevent re-initialization
  const initializedRef = useRef(false)

  // Manage input state internally
  const [nodeInputs, setNodeInputs] = useState<Record<string, any>>({})
  const [nodeErrors, setNodeErrors] = useState<Record<string, string>>({})

  // Proper error handler with immutable updates
  const handleError = useCallback((fieldName: string, errorMessage: string | null) => {
    setNodeErrors((prev) => {
      if (errorMessage === null) {
        // Clear error immutably
        const next = { ...prev }
        delete next[fieldName]
        return next
      }
      // Set error immutably
      return { ...prev, [fieldName]: errorMessage }
    })
  }, [])

  // Get loading state from the hook
  const { isRunning } = useRunSingleNode(nodeId)
  const isLoading = isRunning
  const workflow = useWorkflowStore((state) => state.workflow)
  const { getTestInput, setTestInput } = useTestInputStore()

  const store = useStoreApi()
  const { edges, nodes } = store.getState()

  const upstreamNodeIds = getUpstreamNodeIds(nodeId, edges, nodes)

  // Get node definition
  const nodeDefinition = unifiedNodeRegistry.getDefinition(data.type)!

  // Extract variables only on mount or when config changes significantly
  const [requiredVariablePaths, setRequiredVariablePaths] = useState<any[]>([])

  // Extract variables and sync with test input store ONCE per variable set
  useEffect(() => {
    if (!nodeDefinition?.extractVariables || !data || !workflow?.id) return

    const variables = nodeDefinition.extractVariables(data)
    setRequiredVariablePaths(variables)

    // Only load from test input store if we haven't initialized yet
    // This prevents overwriting user input when switching tabs
    if (!initializedRef.current) {
      const initialInputs: Record<string, any> = {}
      variables.forEach((variableId: string) => {
        const cached = getTestInput(workflow.id, variableId)
        if (cached) {
          initialInputs[variableId] = cached.value
        }
      })

      if (Object.keys(initialInputs).length > 0) {
        setNodeInputs(initialInputs)
      }

      initializedRef.current = true
    }
  }, [nodeDefinition, data, workflow?.id, getTestInput])

  // Get the actual variable objects from the unified store
  const getVariableById = useVarStore((state) => state.actions.getVariableById)
  const requiredVariables = useMemo(() => {
    return requiredVariablePaths.map((variableId) => {
      const variable = getVariableById(variableId)

      if (variable) return variable

      // Create a placeholder variable for missing ones
      // This helps show what variables are needed even if they're not defined yet
      return {
        id: variableId,
        // nodeId: 'unknown',
        // path: variableId,
        // fullPath: variableId,
        label: variableId,
        type: BaseType.STRING, // Default type
        // category: 'node' as const,
        // source: 'Unknown',
        required: true,
        description: `Variable ${variableId} is not defined in any upstream node`,
      } as UnifiedVariable
    })
  }, [requiredVariablePaths, getVariableById])

  // Filter variables to only show those from upstream nodes or system/env
  const availableVariables = useMemo(() => {
    return requiredVariables.filter((variable) => {
      // System and environment variables are always available
      if (variable.category === 'system' || variable.category === 'environment') {
        return false
      }
      // Node variables must come from upstream nodes
      // Extract nodeId from variable.id if nodeId field is not present (for Phase 4 compatibility)
      const varNodeId = getNodeIdFromVariableId(variable.id)

      // If upstreamNodeIds is not loaded yet or variable has no nodeId, exclude it
      if (!upstreamNodeIds || !varNodeId) {
        return false
      }
      return upstreamNodeIds.has(varNodeId)
    })
  }, [requiredVariables, upstreamNodeIds])

  // Check if we can run the node
  const canRun = useMemo(() => {
    // Check if all required variables have values
    const missingRequired = availableVariables
      // .filter((v) => v.required)
      .some((v) => !nodeInputs[v.id])

    // Check if there are validation errors
    const hasErrors = Object.keys(nodeErrors).length > 0

    return !missingRequired && !hasErrors && !isLoading
  }, [availableVariables, nodeInputs, nodeErrors, isLoading])

  // Handle input changes internally
  const handleInputChange = useCallback(
    (newInputs: Record<string, any>) => {
      // Update local state
      setNodeInputs((prevInputs) => ({ ...prevInputs, ...newInputs }))
      // Save to cache
      if (workflow?.id) {
        Object.entries(newInputs).forEach(([variableId, value]) => {
          const variable = requiredVariables.find((v) => v.id === variableId)
          if (variable) {
            // Extract nodeId from variable.id if not present (Phase 4 compatibility)
            // const varNodeId = variable.nodeId || getNodeIdFromVariableId(variable.id)

            setTestInput(workflow.id, variableId, {
              variableId,
              value,
              // nodeId: varNodeId || nodeId,
              type: variable.type || BaseType.STRING,
              lastUpdated: Date.now(),
            })
          }
        })
      }
    },
    [requiredVariables, workflow?.id, setTestInput, nodeId]
  )

  return (
    <Section initialOpen title='Variables'>
      <div className='space-y-4'>
        {/* Variable-specific inputs */}
        {availableVariables.length > 0 && (
          <VarEditorField className='p-0'>
            {availableVariables.map((variable) => (
              <VariableInput
                key={variable.id}
                variable={variable}
                nodes={nodes}
                value={nodeInputs[variable.id]}
                onChange={(value) => {
                  console.log('VariableInput changed:', variable.id, value)
                  handleInputChange({ ...nodeInputs, [variable.id]: value })
                }}
                onError={handleError}
                errors={nodeErrors}
                isLoading={isLoading}
              />
            ))}
          </VarEditorField>
        )}

        {/* No inputs message */}
        {availableVariables.length === 0 && (
          <Alert>
            <AlertCircle className='size-4' />
            <AlertDescription>
              This node doesn't require any inputs. Click "Run Node" to execute.
            </AlertDescription>
          </Alert>
        )}

        {/* Validation errors */}
        {Object.keys(nodeErrors).length > 0 && (
          <Alert variant='destructive'>
            <AlertCircle className='size-4' />
            <AlertDescription>
              Please fix the errors above before running the node.
            </AlertDescription>
          </Alert>
        )}

        {/* Run button */}
        <Button
          onClick={onRun}
          disabled={!canRun}
          loading={isLoading}
          loadingText='Running...'
          className='w-full'>
          <Play />
          Run Node
        </Button>
      </div>
    </Section>
  )
})

/**
 * Simplified variable input component with cached value indicator
 */
const VariableInput = memo(function VariableInput({
  variable,
  nodes,
  value,
  onChange,
  onError,
  errors,
  isLoading,
}: {
  variable: UnifiedVariable
  nodes: FlowNode[]
  value: any
  onChange: (value: any) => void
  onError: (fieldName: string, error: string | null) => void
  errors: Record<string, string>
  isLoading?: boolean
}) {
  const workflow = useWorkflowStore((state) => state.workflow)
  const getTestInput = useTestInputStore((state) => state.getTestInput)

  // Check if there's a cached value available
  const cachedValue = workflow?.id ? getTestInput(workflow.id, variable.id) : null
  const hasCachedValue = cachedValue && !value && cachedValue.value !== value

  // Get relationship metadata using new helper (replaces parseVariable)
  const relationship = getVariableRelationship(variable)

  // Determine actualType: if relationship exists, it's a RELATION type
  const actualType = relationship?.relatedEntityDefinitionId ? BaseType.RELATION : variable.type

  // Get the appropriate input component using actualType (not raw type)
  const InputComponent = getInputComponent(actualType as BaseType)

  // Create component with proper props based on type
  const commonProps = {
    inputs: { [variable.id]: value },
    errors: errors,
    onChange: (name: string, val: any) => onChange(val),
    onError: onError,
    isLoading: isLoading,
  }

  // Add type-specific props
  const specificProps: any = {
    name: variable.id,
    label: variable.label || variable.id,
    description: variable.description,
    required: variable.required,
    placeholder: `Enter ${variable.label}`,
  }

  // Add special props for RELATION/REFERENCE types
  if (relationship?.relatedEntityDefinitionId) {
    specificProps.fieldReference = variable.fieldReference
    specificProps.relatedEntityDefinitionId = relationship.relatedEntityDefinitionId
    specificProps.placeholder = `Select ${variable.label || 'record'}`
  }

  // Add enum values for enum type
  if (variable.type === BaseType.ENUM && variable.enum) {
    specificProps.options = variable.enum
  }

  // Add validation for string types
  if (variable.type === BaseType.EMAIL) {
    specificProps.validationType = 'email'
  } else if (variable.type === BaseType.URL) {
    specificProps.validationType = 'url'
  } else if (variable.type === BaseType.PHONE) {
    specificProps.validationType = 'phone'
  }
  // Extract validation error for VarEditorFieldRow
  const validationError = errors[variable.id]

  return (
    <VarEditorFieldRow
      title={variable.label}
      type={variable.type}
      showIcon
      description={variable.description}
      isRequired={variable.required}
      validationError={validationError}
      validationType={validationError ? 'error' : undefined}>
      <InputComponent {...commonProps} {...specificProps} />
    </VarEditorFieldRow>
  )
})
