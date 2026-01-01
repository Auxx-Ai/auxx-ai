// apps/web/src/components/workflow/nodes/core/list/components/filter-panel.tsx

'use client'

import React, { useMemo } from 'react'
import { ConditionProvider, ConditionContainer } from '~/components/conditions'
import type { ConditionSystemConfig } from '~/components/conditions'
import { useFilterFieldResolver, useFilterConditions } from '../hooks'
import type { ListNodeData } from '../types'

/**
 * Props for the FilterPanel component
 */
interface FilterPanelProps {
  /** Current node data containing filter configuration */
  config: ListNodeData
  /** Callback to update node data */
  onChange: (updates: Partial<ListNodeData>) => void
  /** Available variables (not used - we use hook instead) */
  variables?: any[]
  /** Variable groups (not used - we use hook instead) */
  variableGroups?: any[]
  /** Whether the panel is in read-only mode */
  isReadOnly: boolean
  /** The ID of the current node */
  nodeId: string
}

/**
 * Filter operation configuration panel using the modern ConditionProvider system.
 *
 * This panel automatically detects fields from the input array variable and
 * provides a consistent filtering UI matching the Find and IF/ELSE nodes.
 */
export const FilterPanel: React.FC<FilterPanelProps> = ({
  config,
  onChange,
  isReadOnly,
  nodeId,
}) => {
  // Get field definitions from the array variable
  const { fieldDefinitions, hasFields, isEmpty } = useFilterFieldResolver({
    nodeId,
    inputListValue: config.inputList,
  })

  // Manage conditions
  const { conditions, handleConditionsChange } = useFilterConditions(config, onChange)

  // Configure condition system
  const conditionConfig: ConditionSystemConfig = useMemo(
    () => ({
      mode: 'resource' as const, // Use resource mode for field-based filtering
      fields: fieldDefinitions,
      allowNesting: false,
      allowReordering: true,
      showLogicalOperators: true,
      showGrouping: false, // NO GROUPS - user specifically requested this
      allowVarEditor: true,
      allowConstantToggle: true,
      readOnly: isReadOnly,
    }),
    [fieldDefinitions, isReadOnly]
  )

  // Show hint if no array selected
  if (isEmpty) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        Select an array in "Input List" to configure filters
      </div>
    )
  }

  // Error state: array has no field metadata (this should not happen)
  if (!hasFields) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-center">
        <div className="font-medium text-sm text-destructive">Missing field definitions</div>
        <div className="text-xs mt-2 text-muted-foreground">
          The selected array variable does not define its item structure.
          <br />
          This is likely a bug in the source node. Check the browser console for details.
        </div>
      </div>
    )
  }

  return (
    <ConditionProvider
      conditions={conditions}
      groups={[]} // No groups
      config={conditionConfig}
      nodeId={nodeId}
      onConditionsChange={handleConditionsChange}
      onGroupsChange={() => {}} // No-op
      getAvailableFields={() => fieldDefinitions}
      getFieldDefinition={(id) => fieldDefinitions.find((f) => f.id === id)}>
      <ConditionContainer
        emptyStateText="Click 'Add Condition' to start filtering"
        showAddButton
        showGrouping={false} // NO GROUPS
      />
    </ConditionProvider>
  )
}
