// apps/web/src/components/workflow/hooks/use-workflow-trigger.ts

import type { WorkflowTriggerType } from '@auxx/lib/workflow-engine/types'
import { useStore, useStoreApi } from '@xyflow/react'
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import {
  dynamicTriggerRegistry,
  type TriggerInputConfig,
  triggerRegistry,
} from '../nodes/trigger-registry'
import { unifiedNodeRegistry } from '../nodes/unified-registry'
import type { FlowNode, ValidationResult } from '../types'

/**
 * Return type for the workflow trigger hook
 */
export interface UseWorkflowTriggerReturn {
  /** Whether the workflow has a trigger node */
  hasTrigger: boolean
  /** The trigger node if found */
  triggerNode: FlowNode | null
  /** The type of trigger */
  triggerType: WorkflowTriggerType | null
  /** The trigger configuration from registry */
  triggerConfig: TriggerInputConfig | null
  /** Validate inputs for the current trigger */
  validateTriggerInputs: (inputs: Record<string, any>) => ValidationResult
  /** Get default inputs for the current trigger */
  getDefaultInputs: () => Record<string, any>
}

const nodesLengthSelector = (state: any) => state.nodes.length || 0

const registrySubscribe = (cb: () => void) => unifiedNodeRegistry.subscribe(cb)
const registryGetVersion = () => unifiedNodeRegistry.getVersion()

/**
 * Hook to detect and manage workflow triggers
 * Provides centralized trigger detection and configuration
 */
export function useWorkflowTrigger(): UseWorkflowTriggerReturn {
  const store = useStoreApi()
  const nodesLength = useStore(nodesLengthSelector)
  // Re-run when registry definitions change (e.g. app blocks load async)
  const registryVersion = useSyncExternalStore(registrySubscribe, registryGetVersion)

  // biome-ignore lint/correctness/useExhaustiveDependencies: nodesLength and registryVersion trigger recomputation
  const triggerData = useMemo(() => {
    // Find trigger node in the workflow
    const { nodes } = store.getState()

    const triggerNode = nodes.find((node) => {
      const definition = unifiedNodeRegistry.getDefinition(node.data.type as string)
      return definition?.triggerType !== undefined
    })

    if (!triggerNode) {
      return { hasTrigger: false, triggerNode: null, triggerType: null, triggerConfig: null }
    }

    // Get node type
    const nodeType = triggerNode.data.type as string

    // Get trigger type from node definition
    const definition = unifiedNodeRegistry.getDefinition(nodeType)
    const triggerType = definition?.triggerType || null

    // Get trigger configuration from registry
    let triggerConfig: TriggerInputConfig | null = null

    if (triggerType) {
      // First try standard trigger registry
      triggerConfig = triggerRegistry[triggerType] || null

      // If not found, check dynamic registry by node type
      if (!triggerConfig) {
        triggerConfig = dynamicTriggerRegistry[nodeType] || null
      }
    }

    return { hasTrigger: true, triggerNode: triggerNode as FlowNode, triggerType, triggerConfig }
  }, [nodesLength, registryVersion, store])

  /**
   * Validate inputs for the current trigger
   */
  const validateTriggerInputs = useCallback(
    (inputs: Record<string, any>): ValidationResult => {
      if (!triggerData.triggerConfig) {
        return { isValid: true, errors: [] }
      }

      return triggerData.triggerConfig.validate(inputs)
    },
    [triggerData.triggerConfig]
  )

  /**
   * Get default inputs for the current trigger
   */
  const getDefaultInputs = useCallback((): Record<string, any> => {
    if (!triggerData.triggerConfig) {
      return {}
    }

    return triggerData.triggerConfig.getDefaultInputs()
  }, [triggerData.triggerConfig])

  return { ...triggerData, validateTriggerInputs, getDefaultInputs }
}
