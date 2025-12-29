// apps/web/src/components/workflow/nodes/shared/manual-trigger-input.tsx

'use client'

import { useMemo, useEffect } from 'react'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { AlertCircle } from 'lucide-react'
import { useStore, useStoreApi } from '@xyflow/react'
import { unifiedNodeRegistry } from '../unified-registry'
import type { TriggerInputProps } from '../trigger-registry'
import type { FlowNode } from '../../types'
import type { FormInputNodeData } from '../inputs/form-input/types'
import { WorkflowTriggerType } from '@auxx/lib/workflow-engine/types'
import { VarEditorField } from '../../ui/input-editor/var-editor'
import { FormInputField } from '../../ui/form-input-field'
import { nodeDataToConfig } from '../../utils/form-input-utils'
import { BaseType } from '../../types'

/**
 * Input component for manual trigger that dynamically renders fields
 * based on connected form-input nodes using the VarEditorFieldRow pattern
 */
export function ManualTriggerInput({ inputs, errors, onChange, isLoading }: TriggerInputProps) {
  const store = useStoreApi()
  const nodesLength = useStore((state) => state.nodes.length)

  /**
   * Handle field error (for component compatibility)
   * Note: The parent component manages errors through the errors prop
   */
  const handleError = (nodeId: string, error: string | null) => {
    // Errors are managed at the parent level through the errors prop
  }

  // Get connected form-input configs for the manual trigger
  const formInputConfigs = useMemo(() => {
    const { nodes, edges } = store.getState()

    // Find the manual trigger node
    const manualTrigger = nodes.find((node) => {
      const definition = unifiedNodeRegistry.getDefinition(node.data.type)
      return definition?.triggerType !== undefined && node.data.type === WorkflowTriggerType.MANUAL
    })

    if (!manualTrigger) return []

    // Find form-input nodes connected to the manual trigger's input handle
    const connectedEdges = edges.filter(
      (edge) => edge.target === manualTrigger.id && edge.targetHandle === 'input'
    )

    return connectedEdges
      .map((edge) => {
        const node = nodes.find((n) => n.id === edge.source) as FlowNode | undefined
        if (!node || node.data.type !== 'form-input') return null
        return nodeDataToConfig(node.id, node.data as FormInputNodeData)
      })
      .filter(Boolean) as ReturnType<typeof nodeDataToConfig>[]
  }, [nodesLength, store])

  // Initialize default values for boolean fields
  // This ensures booleans have a defined value (false) rather than undefined
  useEffect(() => {
    for (const config of formInputConfigs) {
      // Only initialize if not already set by parent
      if (inputs[config.nodeId] === undefined) {
        if (config.inputType === BaseType.BOOLEAN) {
          // Booleans default to their configured default or false
          onChange(config.nodeId, config.defaultValue ?? false)
        } else if (config.defaultValue !== undefined) {
          onChange(config.nodeId, config.defaultValue)
        }
      }
    }
  }, [formInputConfigs, inputs, onChange])

  // Show message when no form-input nodes are connected
  if (formInputConfigs.length === 0) {
    return (
      <div className="p-4 pb-0">
        <Alert>
          <AlertCircle />
          <AlertDescription>
            No Form Input nodes connected to this manual trigger. Connect Form Input nodes to
            collect user data before running the workflow.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-2 p-4">
      <div className="mb-3 text-sm font-medium text-muted-foreground">
        Manual Trigger Inputs ({formInputConfigs.length})
      </div>

      <VarEditorField>
        {formInputConfigs.map((config) => (
          <FormInputField
            key={config.nodeId}
            config={config}
            value={inputs[config.nodeId]}
            error={errors[config.nodeId]}
            onChange={onChange}
            onError={handleError}
            isLoading={isLoading}
          />
        ))}
      </VarEditorField>

      {/* Show general errors */}
      {errors.general && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{errors.general}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
