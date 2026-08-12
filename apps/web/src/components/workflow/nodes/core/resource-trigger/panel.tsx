// apps/web/src/components/workflow/nodes/core/resource-trigger/panel.tsx

'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { BaseType, getFieldOperators } from '@auxx/lib/workflow-engine/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import { toResourceFieldId } from '@auxx/types/field'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Info } from 'lucide-react'
import type React from 'react'
import { memo, useCallback, useEffect, useMemo } from 'react'
import type { ConditionSystemConfig, FieldDefinition, Operator } from '~/components/conditions'
import { ConditionContainer, ConditionProvider, STANDARD_OPERATORS } from '~/components/conditions'
import { ResourcePicker } from '~/components/pickers/resource-picker'
import { useResource, useResourceFields } from '~/components/resources'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import Field from '~/components/workflow/ui/field'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import Section from '~/components/workflow/ui/section'
import { useWorkflowResources } from '../../../providers'
import { BasePanel } from '../../shared/base/base-panel'
import { getResourceTriggerName } from '../../shared/resource-trigger-utils'
import { getResourceTriggerOutputVariables } from './output-variables'
import type { ResourceTriggerData } from './types'

/** Operations remain static */
const RESOURCE_OPERATIONS: Record<string, { operation: string; label: string }> = {
  created: { operation: 'created', label: 'Created' },
  updated: { operation: 'updated', label: 'Updated' },
  deleted: { operation: 'deleted', label: 'Deleted' },
  manual: { operation: 'manual', label: 'Manual' },
}

/**
 * `getFieldOperators` and `ResourceField.operatorOverrides` are both typed
 * `string[]` in lib, so keep only the names the condition system knows.
 */
function isOperator(name: string): name is Operator {
  return Object.hasOwn(STANDARD_OPERATORS, name)
}

/**
 * Derive the group's AND/OR from the condition rows.
 *
 * The shared flat condition list owns the AND/OR selector and writes the choice
 * onto every condition after the first, but the engine's evaluator reads only
 * `group.logicalOperator` — leaving it pinned to `AND` would silently ignore an
 * `OR` the author selected. Same derivation as the list node's filter.
 */
function deriveGroupLogic(conditions: ConditionGroup['conditions']): 'AND' | 'OR' {
  for (let index = 1; index < conditions.length; index++) {
    const logicalOperator = conditions[index]?.logicalOperator
    if (logicalOperator) return logicalOperator
  }
  return 'AND'
}

interface ResourceTriggerPanelProps {
  nodeId: string
  data: ResourceTriggerData
}

const ResourceTriggerPanelComponent: React.FC<ResourceTriggerPanelProps> = ({ nodeId, data }) => {
  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<ResourceTriggerData>(
    nodeId,
    data
  )

  // Get all resources dynamically (system + custom entities)
  const { resources } = useWorkflowResources()

  // Get resourceType and operation from node.data
  const resourceType = nodeData.resourceType || 'contact'
  const operation = nodeData.operation || 'created'

  const { isReadOnly } = useReadOnly()

  // Get current resource and its fields
  const { resource: currentResource } = useResource(resourceType)
  const { fields, filterableFields } = useResourceFields(resourceType)

  // Ensure node.data has resourceType, entityDefinitionId, and operation on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount to initialize defaults
  useEffect(() => {
    if (!nodeData.resourceType || !nodeData.operation || !nodeData.entityDefinitionId) {
      const currentResourceData = resources.find((r) => r.id === resourceType)
      setNodeData({
        ...nodeData,
        resourceType: resourceType,
        entityDefinitionId: currentResourceData?.entityDefinitionId || resourceType,
        operation,
      })
    }
  }, []) // Only run once on mount

  // Change handlers
  const handleResourceTypeChange = (newResourceType: string) => {
    const newResource = resources.find((r) => r.id === newResourceType)
    const operationLabel = RESOURCE_OPERATIONS[operation]?.label || ''

    setNodeData({
      ...nodeData,
      resourceType: newResourceType,
      entityDefinitionId: newResource?.entityDefinitionId || newResourceType, // Store entityDefinitionId from resource
      title: `${newResource?.label || newResourceType} ${operationLabel}`,
      icon: newResource?.icon || 'zap',
      // Filters are keyed on the old resource's fields — carrying them over would
      // leave the gate referencing fields the new resource does not have, and the
      // engine refuses to fire on a filter it cannot resolve.
      filters: [],
    })
  }

  const handleOperationChange = (newOperation: string) => {
    const newOperationConfig = RESOURCE_OPERATIONS[newOperation]

    setNodeData({
      ...nodeData,
      operation: newOperation as 'created' | 'updated' | 'deleted' | 'manual',
      title: `${currentResource?.label || resourceType} ${newOperationConfig?.label || ''}`,
    })
  }

  // Build resource with fields for output variable generation (same pattern as Find node)
  const resourceWithFields = useMemo(() => {
    if (!currentResource) return undefined
    return { ...currentResource, fields }
  }, [currentResource, fields])

  // ── Trigger filter ────────────────────────────────────────────────────────
  // The gate that decides whether the workflow runs. Conditions are evaluated by
  // the engine against the triggering record with the shared condition evaluator.

  const fieldDefinitions = useMemo<FieldDefinition[]>(
    () =>
      filterableFields.map((field) => ({
        id: toResourceFieldId(resourceType, field.key),
        label: field.label,
        type: field.type,
        fieldType: field.fieldType,
        fieldKey: field.key,
        operators: (field.operatorOverrides || getFieldOperators(field)).filter(isOperator),
        options: field.options,
        ...(field.type === BaseType.RELATION &&
          field.relationship && {
            fieldReference: toResourceFieldId(resourceType, field.key),
            targetEntityDefinitionId:
              getRelatedEntityDefinitionId(field.relationship as RelationshipConfig) ?? undefined,
          }),
      })),
    [filterableFields, resourceType]
  )

  const filterConfig: ConditionSystemConfig = useMemo(
    () => ({
      mode: 'resource' as const,
      entityDefinitionId: resourceType,
      fields: fieldDefinitions,
      allowNesting: false,
      allowReordering: true,
      showLogicalOperators: true,
      showGrouping: false,
      // Constants only. A trigger fires before any node has run, so there is no
      // workflow variable to reference — the engine refuses to fire a filter that
      // carries one rather than comparing against a literal `{{…}}` string.
      allowVarEditor: false,
      allowConstantToggle: false,
      readOnly: isReadOnly,
    }),
    [fieldDefinitions, resourceType, isReadOnly]
  )

  // One flat group; `ConditionContainer` with `showGrouping: false` edits its
  // conditions in place, and the engine ANDs groups at the top level.
  const filterGroup = nodeData.filters?.[0]
  const filterConditions = filterGroup?.conditions ?? []

  const handleFilterConditionsChange = useCallback(
    (conditions: ConditionGroup['conditions']) => {
      setNodeData({
        ...nodeData,
        filters: conditions.length
          ? [
              {
                id: filterGroup?.id ?? 'trigger-filter',
                conditions,
                logicalOperator: deriveGroupLogic(conditions),
              },
            ]
          : [],
      })
    },
    [nodeData, setNodeData, filterGroup?.id]
  )

  // Generate trigger name for display
  const triggerName = getResourceTriggerName(resourceType, operation)

  return (
    <BasePanel nodeId={nodeId} data={nodeData}>
      {/* Trigger Information */}
      <Section title='General'>
        <div className='space-y-4'>
          <Field
            title='Resource'
            description='Select the operation and type of resource for this trigger'>
            <VarEditorField className='px-0.5'>
              <div className='flex flex-row'>
                <div className=''>
                  <Select value={operation} onValueChange={handleOperationChange}>
                    <SelectTrigger variant='outline' size='xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(RESOURCE_OPERATIONS).map(([key, config]) => (
                        <SelectItem key={key} value={key}>
                          {config.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='flex-1'>
                  <ResourcePicker
                    value={resourceType ? [resourceType] : []}
                    onChange={(selected) => handleResourceTypeChange(selected[0] ?? '')}
                    triggerProps={{ variant: 'transparent', className: 'w-full h-6 pe-2' }}
                    emptyLabel='Select resource...'
                  />
                </div>
              </div>
            </VarEditorField>
          </Field>

          <Field
            title='Only Run When'
            description={
              filterConditions.length === 0
                ? 'No conditions — runs on every record'
                : `Runs only when the record matches ${filterConditions.length} condition${filterConditions.length === 1 ? '' : 's'}`
            }>
            {!currentResource ? (
              <div className='text-center py-8 text-sm text-muted-foreground'>
                Select a resource type to add conditions
              </div>
            ) : (
              <ConditionProvider
                conditions={filterConditions}
                groups={[]}
                config={filterConfig}
                nodeId={nodeId}
                readOnly={isReadOnly}
                onConditionsChange={handleFilterConditionsChange}
                onGroupsChange={() => {}}
                getAvailableFields={() => fieldDefinitions}
                getFieldDefinition={(id) => {
                  const fieldId = Array.isArray(id) ? id.join('.') : id
                  return fieldDefinitions.find((f) => f.id === fieldId)
                }}>
                <ConditionContainer
                  emptyStateText="Click 'Add Condition' to filter which records run this workflow"
                  showAddButton
                  showGrouping={false}
                />
              </ConditionProvider>
            )}
          </Field>
        </div>
      </Section>

      {/* Output Variables Display - call with full context like Find node */}
      <OutputVariablesDisplay
        outputVariables={getResourceTriggerOutputVariables(nodeData, nodeId, {
          resource: resourceWithFields,
          allResources: resources,
          resolveVariable: () => undefined,
        })}
        initialOpen={false}
      />

      <div className='pt-4 px-4'>
        <Alert>
          <Info className='size-4' />
          <AlertDescription>
            <div className='space-y-2'>
              <div>
                {operation === 'manual'
                  ? `This workflow is triggered manually for a specific ${currentResource?.label?.toLowerCase() || resourceType}. The complete data will be available in the workflow.`
                  : `Triggers when a ${currentResource?.label?.toLowerCase() || resourceType} is ${operation}.`}
              </div>
              <div className='font-mono text-xs text-muted-foreground'>Event: {triggerName}</div>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    </BasePanel>
  )
}

export const ResourceTriggerPanel = memo(ResourceTriggerPanelComponent)
