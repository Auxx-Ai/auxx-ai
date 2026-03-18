// apps/web/src/components/workflow/nodes/core/crud/panel.tsx

'use client'

import { isMultiRelationship } from '@auxx/lib/field-values/client'
import type { ResourceField } from '@auxx/lib/resources/client'
import {
  getRelatedEntityDefinitionId,
  type RelationshipConfig,
  RelationUpdateMode,
  type RelationUpdateMode as RelationUpdateModeType,
} from '@auxx/types/custom-field'
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
import { ResourcePicker } from '~/components/pickers/resource-picker'
import { useResource, useResourceFields } from '~/components/resources'
import { useNodeCrud } from '~/components/workflow/hooks'
import { BaseType, VAR_MODE } from '~/components/workflow/types'
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
import { DefaultValuesEditor } from './components/default-values-editor'
import { RelationUpdateModeButton } from './components/relation-update-mode-button'
import { getCrudNodeOutputVariables } from './output-variables'
import { CrudErrorStrategy, type CrudNodeData } from './types'
import { useCrudValidation } from './use-crud-validation'
import { ValidationMessage } from './validation-message'

/**
 * Action-based resources only support update mode
 * These resources have action fields that map to service methods rather than direct DB updates
 */
const ACTION_BASED_RESOURCES = ['thread'] as const

/**
 * Check if a resource type is action-based (update only)
 */
function isActionBasedResource(resourceType: string | undefined): boolean {
  return ACTION_BASED_RESOURCES.includes(resourceType as (typeof ACTION_BASED_RESOURCES)[number])
}

interface CrudPanelProps {
  nodeId: string
  data: CrudNodeData
}

const CrudPanelComponent: React.FC<CrudPanelProps> = ({ nodeId, data }) => {
  const { inputs: nodeData, setInputs } = useNodeCrud<CrudNodeData>(nodeId, data)

  // Validation hook
  const { showValidation, setShowValidation, getFieldErrorMessage, hasFieldErrorOfType } =
    useCrudValidation(nodeData)

  // Use dynamic resource registry hooks
  const { resources } = useWorkflowResources()

  const { resource } = useResource(nodeData.resourceType)

  const { creatableFields, updatableFields } = useResourceFields(nodeData.resourceType ?? null)

  // Generate combined field list based on mode
  const allFields = useMemo(() => {
    if (!resource) return []

    switch (nodeData.mode) {
      case 'create':
        return creatableFields
      case 'update':
        return updatableFields
      case 'delete':
        return []
      default:
        return []
    }
  }, [resource, nodeData.mode, creatableFields, updatableFields])

  const handleResourceTypeChange = useCallback(
    (resourceType: string) => {
      const newData = produce(nodeData, (draft) => {
        draft.resourceType = resourceType
        draft.data = {} // Clear field data when resource type changes
        draft.fieldModes = {} // Clear field modes when resource type changes
        draft.fieldUpdateModes = {} // Clear update modes when resource type changes
        draft.fieldUpdateModeVars = {} // Clear update mode vars when resource type changes

        // Action-based resources only support update mode
        if (isActionBasedResource(resourceType)) {
          draft.mode = 'update'
        }
      })
      setInputs(newData)
      if (!showValidation) setShowValidation(true)
    },
    [nodeData, setInputs, showValidation, setShowValidation]
  )

  const handleModeChange = useCallback(
    (mode: 'create' | 'update' | 'delete') => {
      const newData = produce(nodeData, (draft) => {
        draft.mode = mode
        draft.data = mode === 'delete' ? {} : nodeData.data // Clear data for delete mode
        if (mode === 'delete') {
          draft.fieldModes = {} // Clear field modes for delete mode
        }
      })
      setInputs(newData)
      if (!showValidation) setShowValidation(true)
    },
    [nodeData, setInputs, showValidation, setShowValidation]
  )
  const handleFieldChange = useCallback(
    (fieldKey: string, value: string, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        draft.data[fieldKey] = value

        if (!draft.fieldModes) {
          draft.fieldModes = {}
        }
        draft.fieldModes[fieldKey] = isConstantMode
      })

      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  const handleResourceIdChange = useCallback(
    (value: string, isConstantMode: boolean) => {
      const newData = produce(nodeData, (draft) => {
        draft.resourceId = value
        if (!draft.fieldModes) {
          draft.fieldModes = {}
        }
        draft.fieldModes['resourceId'] = isConstantMode
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  const handleErrorStrategyChange = useCallback(
    (errorStrategy: CrudErrorStrategy) => {
      const newData = produce(nodeData, (draft) => {
        draft.error_strategy = errorStrategy
        draft.default_values =
          errorStrategy === CrudErrorStrategy.default ? nodeData.default_values || [] : []
      })
      setInputs(newData)
      if (!showValidation) setShowValidation(true)
    },
    [nodeData, setInputs, showValidation, setShowValidation]
  )

  const handleDefaultValuesChange = useCallback(
    (defaultValues: CrudNodeData['default_values']) => {
      const newData = produce(nodeData, (draft) => {
        draft.default_values = defaultValues
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  /** Handle relation update mode change */
  const handleFieldUpdateModeChange = useCallback(
    (fieldKey: string, mode: RelationUpdateModeType) => {
      const newData = produce(nodeData, (draft) => {
        if (!draft.fieldUpdateModes) draft.fieldUpdateModes = {}
        draft.fieldUpdateModes[fieldKey] = mode
        // Clear dynamic variable when switching away from dynamic
        if (mode !== RelationUpdateMode.DYNAMIC && draft.fieldUpdateModeVars?.[fieldKey]) {
          delete draft.fieldUpdateModeVars[fieldKey]
        }
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  /** Handle dynamic mode variable change */
  const handleFieldUpdateModeVarChange = useCallback(
    (fieldKey: string, value: string) => {
      const newData = produce(nodeData, (draft) => {
        if (!draft.fieldUpdateModeVars) draft.fieldUpdateModeVars = {}
        draft.fieldUpdateModeVars[fieldKey] = value
      })
      setInputs(newData)
    },
    [nodeData, setInputs]
  )

  // Field mode helpers
  const getFieldMode = useCallback(
    (fieldKey: string): boolean => {
      return nodeData.fieldModes?.[fieldKey] ?? true // default to constant mode
    },
    [nodeData.fieldModes]
  )

  const renderField = useCallback(
    (field: ResourceField) => {
      const value = nodeData.data[field.key] ?? ''
      const isRequired = field.capabilities?.required === true
      const fieldPath = `data.${field.key}`
      const fieldError = showValidation ? getFieldErrorMessage(fieldPath) : undefined
      const hasError = showValidation && hasFieldErrorOfType(fieldPath, 'error')

      // Build fieldOptions with enum, fieldReference, and relationshipType embedded if applicable
      const fieldOptions: {
        enum?: Array<{ label: string; value: string }>
        fieldReference?: string
        relationshipType?: string
        actor?: { target?: 'user' | 'group' | 'both'; multiple?: boolean }
        multiSelect?: boolean
      } = {}
      if (field.options?.options?.length) {
        fieldOptions.enum = field.options.options
      }
      if (field.type === BaseType.RELATION) {
        fieldOptions.fieldReference = `${nodeData.resourceType}:${field.key}`
        fieldOptions.relationshipType = field.relationship?.relationshipType
      }
      if (field.type === BaseType.ACTOR && field.options?.actor) {
        fieldOptions.actor = field.options.actor
      }

      // Detect multi-select fields for dropdown input and update mode badge
      const isMultiSelect = field.fieldType === 'MULTI_SELECT'
      if (isMultiSelect) {
        fieldOptions.multiSelect = true
      }

      // Detect multi-relation fields for update mode badge
      const isMultiRelation =
        field.type === BaseType.RELATION &&
        field.relationship &&
        isMultiRelationship(field.relationship.relationshipType)
      const showUpdateMode = nodeData.mode === 'update' && (isMultiRelation || isMultiSelect)
      const currentUpdateMode = nodeData.fieldUpdateModes?.[field.key] ?? RelationUpdateMode.REPLACE

      // Determine allowed types for type filtering
      const allowedTypes: BaseType[] = []

      if (field.type === BaseType.RELATION) {
        if (field.relationship) {
          // Primary path: Use getRelatedEntityDefinitionId helper - cast to BaseType for type safety
          const relatedEntityId = getRelatedEntityDefinitionId(
            field.relationship as RelationshipConfig
          )
          if (relatedEntityId) {
            allowedTypes.push(relatedEntityId as BaseType)
          }
        } else {
          // Error case: RELATION field with no way to determine target
          console.error(
            `RELATION field missing both relationship property and fieldReference`,
            field
          )
        }
      } else if (field.type !== BaseType.ANY) {
        // For non-relation fields, allow matching type
        allowedTypes.push(field.type)
      }

      return (
        <VarEditorFieldRow
          key={field.key}
          title={field.label}
          description={field.description}
          type={field.type}
          isRequired={isRequired}
          validationError={showValidation ? fieldError : undefined}
          validationType={hasError ? 'error' : 'warning'}
          onClear={
            value != null && value !== ''
              ? () => handleFieldChange(field.key, '', getFieldMode(field.key))
              : undefined
          }>
          {showUpdateMode ? (
            <div className='relative'>
              <div className='absolute right-full top-1/2 -translate-y-1/2 me-0.5 z-10'>
                <RelationUpdateModeButton
                  mode={currentUpdateMode}
                  onChange={(mode) => handleFieldUpdateModeChange(field.key, mode)}
                  nodeId={nodeId}
                  dynamicModeVar={nodeData.fieldUpdateModeVars?.[field.key]}
                  onDynamicModeVarChange={(val) => handleFieldUpdateModeVarChange(field.key, val)}
                />
              </div>
              <VarEditor
                nodeId={nodeId}
                value={value}
                onChange={(newValue, isConstantMode) => {
                  handleFieldChange(field.key, newValue, isConstantMode)
                }}
                varType={field.type}
                fieldOptions={Object.keys(fieldOptions).length > 0 ? fieldOptions : undefined}
                allowedTypes={allowedTypes}
                placeholderConstant={field.placeholder}
                placeholder={field.placeholder}
                allowConstant={true}
                isConstantMode={getFieldMode(field.key)}
                hideClearButton
              />
            </div>
          ) : (
            <VarEditor
              nodeId={nodeId}
              value={value}
              onChange={(newValue, isConstantMode) => {
                handleFieldChange(field.key, newValue, isConstantMode)
              }}
              varType={field.type}
              fieldOptions={Object.keys(fieldOptions).length > 0 ? fieldOptions : undefined}
              allowedTypes={allowedTypes}
              placeholderConstant={field.placeholder}
              placeholder={field.placeholder}
              allowConstant={true}
              isConstantMode={getFieldMode(field.key)}
              hideClearButton
            />
          )}
        </VarEditorFieldRow>
      )
    },
    [
      nodeData.data,
      nodeData.resourceType,
      nodeData.mode,
      nodeData.fieldUpdateModes,
      nodeData.fieldUpdateModeVars,
      showValidation,
      getFieldErrorMessage,
      hasFieldErrorOfType,
      nodeId,
      handleFieldChange,
      handleFieldUpdateModeChange,
      handleFieldUpdateModeVarChange,
      getFieldMode,
    ]
  )

  return (
    <BasePanel nodeId={nodeId} data={nodeData}>
      <Section title='General'>
        <div className='space-y-4'>
          <Field
            title='Resource'
            description='Select the type of resource and operation to perform'>
            <VarEditorField className='p-0'>
              <div className='flex flex-row p-1'>
                <div className=''>
                  <Select
                    value={nodeData.mode}
                    onValueChange={handleModeChange}
                    disabled={isActionBasedResource(nodeData.resourceType)}>
                    <SelectTrigger variant='outline' size='xs'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {isActionBasedResource(nodeData.resourceType) ? (
                        <SelectItem value='update'>Update</SelectItem>
                      ) : (
                        <>
                          <SelectItem value='create'>Create</SelectItem>
                          <SelectItem value='update'>Update</SelectItem>
                          <SelectItem value='delete'>Delete</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  {showValidation && getFieldErrorMessage('mode') && (
                    <ValidationMessage
                      type={hasFieldErrorOfType('mode', 'error') ? 'error' : 'warning'}
                      message={getFieldErrorMessage('mode')!}
                    />
                  )}
                </div>
                <div className='flex-1'>
                  <ResourcePicker
                    value={nodeData.resourceType ? [nodeData.resourceType] : []}
                    onChange={(selected) => handleResourceTypeChange(selected[0] ?? '')}
                    triggerProps={{ variant: 'transparent', className: 'w-full h-6 pe-2' }}
                    emptyLabel='Select resource...'
                  />
                  {showValidation && getFieldErrorMessage('resourceType') && (
                    <ValidationMessage
                      type={hasFieldErrorOfType('resourceType', 'error') ? 'error' : 'warning'}
                      message={getFieldErrorMessage('resourceType')!}
                    />
                  )}
                </div>
              </div>
              {(nodeData.mode === 'update' || nodeData.mode === 'delete') && (
                <VarEditorFieldRow
                  className='border-t pe-2'
                  title='Resource'
                  description='Select the resource by type or ID to update or delete '
                  type={BaseType.STRING}
                  isRequired
                  validationError={showValidation ? getFieldErrorMessage('resourceId') : undefined}
                  validationType={hasFieldErrorOfType('resourceId', 'error') ? 'error' : 'warning'}
                  onClear={
                    nodeData.resourceId
                      ? () => handleResourceIdChange('', getFieldMode('resourceId'))
                      : undefined
                  }>
                  <VarEditor
                    nodeId={nodeId}
                    value={nodeData.resourceId || ''}
                    onChange={(value, isConstantMode) => {
                      handleResourceIdChange(value, isConstantMode)
                      if (!showValidation) setShowValidation(true)
                    }}
                    varType={BaseType.RELATION}
                    allowedTypes={[nodeData.resourceType as BaseType, BaseType.STRING]}
                    mode={VAR_MODE.PICKER}
                    placeholder={`Select ${resource?.label || 'resource'} or enter ID`}
                    allowConstant={false}
                    hideClearButton
                  />
                </VarEditorFieldRow>
              )}
            </VarEditorField>
            {isActionBasedResource(nodeData.resourceType) && (
              <p className='mt-2 text-xs text-muted-foreground'>
                Thread operations are action-based. Select which actions to perform below. Leave
                fields empty to skip that action.
              </p>
            )}
          </Field>

          {/* <Field title="Authentication" description="Connect a credential for API authentication">
          <NodeCredentialButton
            allowedCredentialTypes={['httpBasicAuth', 'httpHeaderAuth', 'oAuth2Api']}
            nodeId={nodeId}
            currentCredentialId={nodeData.credentialId}
            onCredentialConnected={handleCredentialConnected}
            onCredentialDisconnected={handleCredentialDisconnected}
            variant="outline"
            size="sm"
          />
        </Field> */}
        </div>
      </Section>

      {nodeData.mode !== 'delete' && allFields.length > 0 && (
        <Section
          title={isActionBasedResource(nodeData.resourceType) ? 'Actions' : 'Field Data'}
          description={
            isActionBasedResource(nodeData.resourceType)
              ? 'Leave fields empty to skip that action'
              : undefined
          }>
          <VarEditorField className='p-0'>
            {(allFields as ResourceField[]).map(renderField)}
          </VarEditorField>
        </Section>
      )}

      <Section
        title='Error Handling'
        collapsible={nodeData.error_strategy === CrudErrorStrategy.default}
        open={nodeData.error_strategy === CrudErrorStrategy.default}
        className='[&>[data-slot=section]]:pb-0!'
        actions={
          <Select
            value={nodeData.error_strategy || CrudErrorStrategy.fail}
            onValueChange={handleErrorStrategyChange}>
            <SelectTrigger size='sm'>
              <SelectValue placeholder='Select strategy' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                value={CrudErrorStrategy.fail}
                description='Stop workflow and route to fail branch'>
                Fail
              </SelectItem>
              <SelectItem
                value={CrudErrorStrategy.continue}
                description='Continue workflow with error information'>
                Continue
              </SelectItem>
              <SelectItem
                value={CrudErrorStrategy.default}
                description='Use default values and continue'>
                Default Values
              </SelectItem>
            </SelectContent>
          </Select>
        }>
        {showValidation && getFieldErrorMessage('error_strategy') && (
          <ValidationMessage
            type={hasFieldErrorOfType('error_strategy', 'error') ? 'error' : 'warning'}
            message={getFieldErrorMessage('error_strategy')!}
          />
        )}

        {nodeData.error_strategy === CrudErrorStrategy.default && (
          <Field title='Default Values' description='Fallback values to use when operations fail'>
            <DefaultValuesEditor
              defaultValues={nodeData.default_values || []}
              onChange={handleDefaultValuesChange}
            />
            {showValidation && getFieldErrorMessage('default_values') && (
              <ValidationMessage
                type={hasFieldErrorOfType('default_values', 'error') ? 'error' : 'warning'}
                message={getFieldErrorMessage('default_values')!}
              />
            )}
          </Field>
        )}
      </Section>

      <OutputVariablesDisplay
        outputVariables={getCrudNodeOutputVariables(nodeData, nodeId, {
          resource,
          allResources: resources,
          resolveVariable: () => undefined,
        })}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const CrudPanel = memo(CrudPanelComponent)
