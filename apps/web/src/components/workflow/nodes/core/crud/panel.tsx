// apps/web/src/components/workflow/nodes/core/crud/panel.tsx

'use client'

import React, { memo, useMemo, useCallback } from 'react'
import { produce } from 'immer'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { type CrudNodeData, CrudErrorStrategy } from './types'
import { DefaultValuesEditor } from './components/default-values-editor'
import { BasePanel } from '../../shared/base/base-panel'
import { useNodeCrud } from '~/components/workflow/hooks'
import Section from '~/components/workflow/ui/section'
import Field from '~/components/workflow/ui/field'
import { OutputVariablesDisplay } from '~/components/workflow/ui/output-variables'
import {
  VarEditor,
  VarEditorField,
  VarEditorFieldRow,
} from '~/components/workflow/ui/input-editor/var-editor'
import { VAR_MODE, BaseType } from '~/components/workflow/types'
import type { ResourceField } from '@auxx/lib/resources/client'
import { getRelatedEntityDefinitionId, type RelationshipConfig } from '@auxx/types/custom-field'
import { useWorkflowResources } from '../../../providers'
import { useResource, useResourceFields } from '~/components/resources'
import { EntityIcon } from '@auxx/ui/components/icons'
import { getCrudNodeOutputVariables } from './output-variables'
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
  const { resources, getResourceById } = useWorkflowResources()
  const { resource } = useResource(nodeData.resourceType)
  console.log('Resource in CRUD panel:', resource)
  // const resource = getResourceById(nodeData.resourceType)
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

  // Resource options for selector
  const resourceOptions = useMemo(
    () =>
      resources.map((r) => ({
        value: r.id,
        label: r.label,
        icon: r.icon,
      })),
    [resources]
  )

  const handleResourceTypeChange = useCallback(
    (resourceType: string) => {
      const newData = produce(nodeData, (draft) => {
        draft.resourceType = resourceType
        draft.data = {} // Clear field data when resource type changes
        draft.fieldModes = {} // Clear field modes when resource type changes

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

  // Field mode helpers
  const getFieldMode = useCallback(
    (fieldKey: string): boolean => {
      return nodeData.fieldModes?.[fieldKey] ?? true // default to constant mode
    },
    [nodeData.fieldModes]
  )

  const renderField = useCallback(
    (field: ResourceField) => {
      const value = nodeData.data[field.key] || ''
      const isRequired = field.capabilities?.required === true
      const fieldPath = `data.${field.key}`
      const fieldError = showValidation ? getFieldErrorMessage(fieldPath) : undefined
      const hasError = showValidation && hasFieldErrorOfType(fieldPath, 'error')

      // Build fieldOptions with enum and fieldReference embedded if applicable
      const fieldOptions: {
        enum?: Array<{ label: string; value: string }>
        fieldReference?: string
      } = {}
      if (field.enumValues) {
        fieldOptions.enum = field.enumValues.map((ev) => ({ label: ev.label, value: ev.dbValue }))
      }
      if (field.type === BaseType.RELATION) {
        fieldOptions.fieldReference = `${nodeData.resourceType}:${field.key}`
      }

      // Determine allowed types for type filtering
      const allowedTypes: BaseType[] = []

      if (field.type === BaseType.RELATION) {
        if (field.relationship) {
          // Primary path: Use getRelatedEntityDefinitionId helper - cast to BaseType for type safety
          const relatedEntityId = getRelatedEntityDefinitionId(field.relationship as RelationshipConfig)
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
      console.log('Allowed types for field', field.key, ':', allowedTypes)

      return (
        <VarEditorFieldRow
          key={field.key}
          title={field.label}
          description={field.description}
          type={field.type}
          isRequired={isRequired}
          validationError={showValidation ? fieldError : undefined}
          validationType={hasError ? 'error' : 'warning'}>
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
          />
        </VarEditorFieldRow>
      )
    },
    [
      nodeData.data,
      nodeData.resourceType,
      showValidation,
      getFieldErrorMessage,
      hasFieldErrorOfType,
      nodeId,
      handleFieldChange,
      getFieldMode,
    ]
  )

  return (
    <BasePanel nodeId={nodeId} data={nodeData}>
      <Section title="General">
        <div className="space-y-4">
          <Field
            title="Resource"
            description="Select the type of resource and operation to perform">
            <VarEditorField className="p-0">
              <div className="flex flex-row p-1">
                <div className="">
                  <Select
                    value={nodeData.mode}
                    onValueChange={handleModeChange}
                    disabled={isActionBasedResource(nodeData.resourceType)}>
                    <SelectTrigger variant="outline" size="xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {isActionBasedResource(nodeData.resourceType) ? (
                        <SelectItem value="update">Update</SelectItem>
                      ) : (
                        <>
                          <SelectItem value="create">Create</SelectItem>
                          <SelectItem value="update">Update</SelectItem>
                          <SelectItem value="delete">Delete</SelectItem>
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
                <div className="flex-1">
                  <Select value={nodeData.resourceType} onValueChange={handleResourceTypeChange}>
                    <SelectTrigger variant="transparent" size="xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {resourceOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value} className="ps-1">
                          <div className="flex items-center">
                            <EntityIcon
                              iconId={option.icon}
                              variant="full"
                              size="sm"
                              className="mr-1"
                            />
                            {option.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                  className="border-t pe-2"
                  title="Resource"
                  description="Select the resource by type or ID to update or delete "
                  type={BaseType.STRING}
                  isRequired
                  validationError={showValidation ? getFieldErrorMessage('resourceId') : undefined}
                  validationType={hasFieldErrorOfType('resourceId', 'error') ? 'error' : 'warning'}>
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

                    // onConstantModeChange={(isConstant) => setFieldMode('resourceId', isConstant)}
                  />
                </VarEditorFieldRow>
              )}
            </VarEditorField>
            {isActionBasedResource(nodeData.resourceType) && (
              <p className="mt-2 text-xs text-muted-foreground">
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
          <VarEditorField className="p-0">
            {(allFields as ResourceField[]).map(renderField)}
          </VarEditorField>
        </Section>
      )}

      <Section title="Error Handling">
        <div className="space-y-4">
          <Field title="Error Strategy" description="How to handle errors during CRUD operations">
            <Select
              value={nodeData.error_strategy || CrudErrorStrategy.fail}
              onValueChange={handleErrorStrategyChange}>
              <SelectTrigger variant="default" size="sm">
                <SelectValue placeholder="Select error strategy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CrudErrorStrategy.fail}>
                  Fail - Stop workflow and route to fail branch
                </SelectItem>
                <SelectItem value={CrudErrorStrategy.continue}>
                  Continue - Continue workflow with error information
                </SelectItem>
                <SelectItem value={CrudErrorStrategy.default}>
                  Default - Use default values and continue
                </SelectItem>
              </SelectContent>
            </Select>
            {showValidation && getFieldErrorMessage('error_strategy') && (
              <ValidationMessage
                type={hasFieldErrorOfType('error_strategy', 'error') ? 'error' : 'warning'}
                message={getFieldErrorMessage('error_strategy')!}
              />
            )}
          </Field>

          {nodeData.error_strategy === CrudErrorStrategy.default && (
            <Field title="Default Values" description="Fallback values to use when operations fail">
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
        </div>
      </Section>

      <OutputVariablesDisplay
        outputVariables={getCrudNodeOutputVariables(nodeData, nodeId, resource, resources)}
        initialOpen={false}
      />
    </BasePanel>
  )
}

export const CrudPanel = memo(CrudPanelComponent)
