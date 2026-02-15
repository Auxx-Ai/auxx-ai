// apps/web/src/components/workflow/nodes/actions/find/panel.tsx

'use client'

import { BaseType, getFieldOperators } from '@auxx/lib/workflow-engine/client'
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
import type { ConditionSystemConfig } from '~/components/conditions'
import { ConditionContainer, ConditionProvider } from '~/components/conditions'
import { ResourcePicker } from '~/components/pickers/resource-picker'
import { useResource, useResourceFields } from '~/components/resources'
import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'
import { VAR_MODE } from '~/components/workflow/types'
import Field from '~/components/workflow/ui/field'
import {
  VarEditor,
  VarEditorField,
  VarEditorFieldRow,
} from '~/components/workflow/ui/input-editor/var-editor'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import Section from '~/components/workflow/ui/section'
import { useWorkflowResources } from '../../../providers'
import { BasePanel } from '../../shared/base/base-panel'
import { useFindGroups } from './hooks/use-find-groups'
import { getFindNodeOutputVariables } from './output-variables'
import type { FindNodeData } from './types'

interface FindPanelProps {
  nodeId: string
  data: FindNodeData
}

const FindPanelComponent: React.FC<FindPanelProps> = ({ nodeId, data }) => {
  const { isReadOnly } = useReadOnly()
  const { inputs: nodeData, setInputs: setNodeData } = useNodeCrud<FindNodeData>(nodeId, data)
  const { resources } = useWorkflowResources()

  /**
   * Handle number field change (limit)
   * In variable mode, store the variable reference as string
   * In constant mode, parse and store as number
   * Clears value when switching between constant/variable mode
   */
  const handleNumberChange = useCallback(
    (field: 'limit', value: any, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        const wasConstantMode = draft.fieldModes?.[field] ?? true
        const modeChanged = wasConstantMode !== isConstantMode

        if (modeChanged) {
          // Clear value when switching modes
          draft[field] = undefined
        } else if (isConstantMode) {
          // Constant mode: parse as number
          const numValue = typeof value === 'number' ? value : parseInt(value, 10)
          draft[field] = Number.isNaN(numValue) ? undefined : numValue
        } else {
          // Variable mode: store as string (variable reference)
          draft[field] = value as any
        }
        if (!draft.fieldModes) draft.fieldModes = {}
        draft.fieldModes[field] = isConstantMode
      })
      setNodeData(newData)
    },
    [nodeData, setNodeData]
  )

  // Get resource and fields for current selection
  const { resource } = useResource(nodeData.resourceType)
  const {
    filterableFields,
    sortableFields,
    isLoading: isLoadingFields,
  } = useResourceFields(nodeData.resourceType)
  // Group management hooks
  const groupHooks = useFindGroups(nodeData, setNodeData)

  // Convert filterable fields to field definitions for condition builder
  const fieldDefinitions = useMemo(() => {
    return filterableFields.map((field) => ({
      id: field.key,
      label: field.label,
      type: field.type,
      fieldType: field.fieldType,
      operators: field.operatorOverrides || getFieldOperators(field),
      // Pass options for select fields
      options: field.options?.options,
      // Add fieldReference for RELATION type fields
      // Format: "resourceType:fieldKey" (e.g., "ticket:contact")
      ...(field.type === BaseType.RELATION &&
        field.relationship && {
          fieldReference: `${nodeData.resourceType}:${field.key}`,
        }),
    }))
  }, [filterableFields, nodeData.resourceType])

  const config: ConditionSystemConfig = useMemo(
    () => ({
      mode: 'resource' as const,
      fields: fieldDefinitions,
      allowNesting: false,
      allowReordering: true, // Enable reordering for groups
      showLogicalOperators: true,
      showGrouping: true, // Always show grouping for find nodes

      // NEW: Enable new features
      allowGroupNaming: false,
      allowGroupCollapse: false,
      allowGroupReordering: true,
      showGroupSubtext: false, // Optional for find

      defaultGroupName: 'Group',
      groupNamePlaceholder: 'Name this filter...',

      allowVarEditor: true, // Enable VarEditor for all field types
      allowConstantToggle: true, // Enable constant/variable mode toggle
    }),
    [fieldDefinitions]
  )

  const handleResourceTypeChange = (resourceType: string) => {
    setNodeData({
      ...nodeData,
      resourceType,
      conditions: [], // Clear conditions when resource type changes
      conditionGroups: [], // Clear groups when resource type changes
      orderBy: undefined, // Clear sorting
    })
  }
  // Show loading state while fields are loading
  if (isLoadingFields && nodeData.resourceType) {
    return (
      <BasePanel nodeId={nodeId} data={nodeData}>
        <Section title='General'>
          <div className='text-center py-8 text-sm text-muted-foreground'>
            Loading resource fields...
          </div>
        </Section>
      </BasePanel>
    )
  }

  return (
    <BasePanel nodeId={nodeId} data={nodeData}>
      <Section title='General'>
        <div className='space-y-4'>
          <Field
            title='Resource'
            description='Select the find mode and type of resource to find records from'>
            <VarEditorField className='px-0.5'>
              <div className='flex flex-row'>
                <div className=''>
                  <Select
                    value={nodeData.findMode}
                    onValueChange={(value: 'findOne' | 'findMany') =>
                      setNodeData({ ...nodeData, findMode: value })
                    }>
                    <SelectTrigger variant='outline' size='xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='findOne'>Find One</SelectItem>
                      <SelectItem value='findMany'>Find Many</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className='flex-1'>
                  <ResourcePicker
                    value={nodeData.resourceType ? [nodeData.resourceType] : []}
                    onChange={(selected) => handleResourceTypeChange(selected[0] ?? '')}
                    triggerProps={{ variant: 'transparent', className: 'w-full h-6 pe-2' }}
                    emptyLabel='Select resource...'
                  />
                </div>
              </div>
            </VarEditorField>
          </Field>
          <Field
            title='Filter Rules'
            description={
              !resource
                ? 'Select a resource type to add condition groups'
                : !nodeData.conditionGroups || nodeData.conditionGroups.length === 0
                  ? 'No condition groups - will return all records'
                  : `${nodeData.conditionGroups.length} group${nodeData.conditionGroups.length === 1 ? '' : 's'} with ${nodeData.conditionGroups.reduce((total, group) => total + group.conditions.length, 0)} total conditions`
            }>
            {!resource ? (
              <div className='text-center py-8 text-sm text-muted-foreground'>
                Select a resource type to add condition groups
              </div>
            ) : (
              <ConditionProvider
                conditions={[]} // Empty for grouped mode
                groups={nodeData.conditionGroups || []}
                config={config}
                nodeId={nodeId} // Pass nodeId for VarEditor context
                readOnly={isReadOnly}
                onConditionsChange={() => {}} // No-op for grouped mode
                onGroupsChange={groupHooks.handleGroupsChange}
                getAvailableFields={() => fieldDefinitions}
                getFieldDefinition={(id) => fieldDefinitions.find((f) => f.id === id)}>
                <ConditionContainer
                  emptyStateText="Click 'Add Group' to start filtering"
                  showAddButton
                  showGrouping
                />
              </ConditionProvider>
            )}
          </Field>
        </div>
      </Section>

      <Section title='Advanced Settings' initialOpen={false}>
        <div className='space-y-3'>
          <Field title='Order By' description='Sort results by a specific field'>
            <VarEditorField className='pe-0.5'>
              <div className='flex gap-2'>
                <Select
                  value={nodeData.orderBy?.field || 'none'}
                  onValueChange={(field) =>
                    setNodeData({
                      ...nodeData,
                      orderBy:
                        field !== 'none'
                          ? { field, direction: nodeData.orderBy?.direction || 'desc' }
                          : undefined,
                    })
                  }>
                  <SelectTrigger className='flex-1' variant='transparent' size='sm'>
                    <SelectValue placeholder='Select field' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='none'>No sorting</SelectItem>
                    {sortableFields.map((field) => (
                      <SelectItem key={field.key} value={field.key}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={nodeData.orderBy?.direction || 'desc'}
                  onValueChange={(direction: 'asc' | 'desc') =>
                    nodeData.orderBy &&
                    setNodeData({
                      ...nodeData,
                      orderBy: { ...nodeData.orderBy, direction },
                    })
                  }
                  disabled={!nodeData.orderBy?.field}>
                  <SelectTrigger className='w-24' variant='outline' size='sm'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='asc'>ASC</SelectItem>
                    <SelectItem value='desc'>DESC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </VarEditorField>
          </Field>

          {nodeData.findMode === 'findMany' && (
            <Field title='Limit' description='Maximum number of results to return'>
              <VarEditorField className='p-0'>
                <VarEditorFieldRow
                  className='pe-2'
                  title='Limit'
                  description='Maximum number of results to return'
                  type={BaseType.NUMBER}>
                  <VarEditor
                    nodeId={nodeId}
                    value={nodeData.limit}
                    onChange={(value, isConstantMode) =>
                      handleNumberChange('limit', value, isConstantMode)
                    }
                    varType={BaseType.NUMBER}
                    mode={VAR_MODE.PICKER}
                    allowedTypes={[BaseType.NUMBER]}
                    placeholder='Pick variable'
                    placeholderConstant='Enter limit'
                    allowConstant
                    isConstantMode={nodeData.fieldModes?.['limit'] ?? true}
                  />
                </VarEditorFieldRow>
              </VarEditorField>
            </Field>
          )}
        </div>
      </Section>

      <OutputVariablesDisplay
        outputVariables={getFindNodeOutputVariables(nodeData, nodeId, resource, resources)}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const FindPanel = memo(FindPanelComponent)
