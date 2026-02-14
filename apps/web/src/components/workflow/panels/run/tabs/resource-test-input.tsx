// apps/web/src/components/workflow/panels/run/tabs/resource-test-input.tsx

'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { getInstanceId, toRecordId } from '@auxx/lib/resources/client'
import type { ResourceId } from '@auxx/lib/workflow-engine/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { AlertCircle, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'
import { useRecord, useResource } from '~/components/resources'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'
import { BaseType } from '~/components/workflow/types'
import { CodeEditor, CodeLanguage } from '~/components/workflow/ui/code-editor'
import Field from '~/components/workflow/ui/field'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import Section from '~/components/workflow/ui/section'

interface ResourceTestInputProps {
  resourceType: ResourceId
  operation: 'created' | 'updated' | 'deleted'
  inputs: Record<string, any>
  errors: Record<string, string>
  onChange: (name: string, value: any) => void
}

/**
 * Enhanced resource trigger input with smart resource picker
 * Allows selecting actual resources from database OR entering custom JSON
 */
export function ResourceTestInput({
  resourceType,
  operation,
  inputs,
  errors,
  onChange,
}: ResourceTestInputProps) {
  // Get resource config from provider (supports both system and custom resources)
  const { resource, isLoading: isLoadingResources } = useResource(resourceType)

  console.log('ResourceTestInput render', { resourceType, resource, inputs })

  // Construct RecordId from entityDefinitionId and entityInstanceId
  // Note: inputs.selectedRecordId is the entityInstanceId (string), not a full RecordId
  const selectedRecordId = useMemo(
    () => (inputs.selectedRecordId ? toRecordId(resourceType, inputs.selectedRecordId) : null),
    [resourceType, inputs.selectedRecordId]
  )

  // Fetch resource data when user picks a resource (uses batching system)
  const {
    record: selectedResource,
    isLoading: isLoadingResource,
    isNotFound,
  } = useRecord({
    recordId: selectedRecordId ?? undefined,
    enabled: !!inputs.selectedRecordId && !!resource,
  })

  // Memoize onChange wrapper to prevent unnecessary re-renders
  const handleChange = useCallback(
    (name: string, value: any) => {
      onChange(name, value)
    },
    [onChange]
  )

  // Handle resource selection
  const handleResourceSelect = useCallback(
    (value: { referenceId: string } | null) => {
      if (!value) {
        handleChange('selectedRecordId', null)
        handleChange('resourceData', {})
        return
      }

      handleChange('selectedRecordId', value.referenceId)
      // Resource data will be loaded by the query and set via useEffect
    },
    [handleChange]
  )

  // Update resourceData when selected resource loads
  useEffect(() => {
    if (selectedResource) {
      // Record from useRecord has direct data property
      handleChange('resourceData', selectedResource.data)
    }
  }, [selectedResource, handleChange])

  // Show error toast if resource not found
  useEffect(() => {
    if (isNotFound && inputs.selectedRecordId) {
      toastError({
        title: 'Resource not found',
        description: 'The selected resource could not be found. It may have been deleted.',
      })
      handleChange('selectedRecordId', null)
    }
  }, [isNotFound, inputs.selectedRecordId, handleChange])

  // Show loading state while resources load
  if (isLoadingResources) {
    return (
      <Section title='Resource Trigger' initialOpen>
        <div className='flex items-center gap-2 text-sm text-muted-foreground'>
          <Loader2 className='h-4 w-4 animate-spin' />
          Loading resource configuration...
        </div>
      </Section>
    )
  }

  // Validate resource type exists
  if (!resource) {
    return (
      <Section title='Resource Trigger' initialOpen>
        <div className='flex items-center gap-2 text-sm text-destructive'>
          <AlertCircle className='h-4 w-4' />
          Invalid resource type: {resourceType}
        </div>
      </Section>
    )
  }

  return (
    <Section title={`${resource.label} ${operation}`} initialOpen>
      <div className='space-y-4'>
        {/* Resource Picker Mode */}
        <VarEditorField>
          <VarEditorFieldRow
            className='p-0'
            title='Resource'
            description={`Select the ${resource.label.toLowerCase()} by type or ID to ${operation === 'created' ? 'create' : operation === 'updated' ? 'update' : 'delete'}`}
            type={BaseType.RELATION}
            isRequired
            validationError={errors.resourceData}
            validationType={errors.resourceData ? 'error' : undefined}>
            <div className='flex items-center gap-2 flex-1'>
              <MultiRelationInput
                className='flex-1'
                entityDefinitionId={resourceType}
                value={selectedRecordId ? [selectedRecordId] : []}
                onChange={(recordIds: RecordId[]) =>
                  handleResourceSelect(
                    recordIds[0] ? { referenceId: getInstanceId(recordIds[0]) } : null
                  )
                }
                multi={false}
              />
              {selectedRecordId && (
                <Button variant='ghost' size='sm' onClick={() => handleResourceSelect(null)}>
                  Clear
                </Button>
              )}
            </div>
          </VarEditorFieldRow>
        </VarEditorField>
        {/* Loading indicator */}
        {isLoadingResource && (
          <div className='flex items-center gap-2 text-sm text-muted-foreground px-4'>
            <Loader2 className='h-3 w-3 animate-spin' />
            Loading resource data...
          </div>
        )}
        {/* Operation-specific fields */}
        {operation === 'updated' && (
          <>
            <Field
              title='Changed Fields'
              description='Array of field names that were changed. List the fields that were modified in this update'>
              <CodeEditor
                value={
                  typeof inputs.changedFields === 'string'
                    ? inputs.changedFields
                    : JSON.stringify(inputs.changedFields || [], null, 2)
                }
                onChange={(value) => {
                  try {
                    const parsed = JSON.parse(value)
                    handleChange('changedFields', parsed)
                  } catch {
                    handleChange('changedFields', value)
                  }
                }}
                language={CodeLanguage.json}
                readOnly={false}
                minHeight={100}
              />
              {errors.changedFields && (
                <p className='text-sm text-destructive mt-1'>{errors.changedFields}</p>
              )}
            </Field>

            <Field
              title='Previous Values'
              description='Object containing previous values of changed fields. The values these fields had before the update'>
              <CodeEditor
                value={
                  typeof inputs.previousValues === 'string'
                    ? inputs.previousValues
                    : JSON.stringify(inputs.previousValues || {}, null, 2)
                }
                onChange={(value) => {
                  try {
                    const parsed = JSON.parse(value)
                    handleChange('previousValues', parsed)
                  } catch {
                    handleChange('previousValues', value)
                  }
                }}
                language={CodeLanguage.json}
                readOnly={false}
                minHeight={100}
              />
              {errors.previousValues && (
                <p className='text-sm text-destructive mt-1'>{errors.previousValues}</p>
              )}
            </Field>
          </>
        )}
        {operation === 'deleted' && (
          <Field
            title='Deleted By'
            description='Information about the user who deleted this resource. User object with id, email, and name'>
            <CodeEditor
              value={
                typeof inputs.deletedBy === 'string'
                  ? inputs.deletedBy
                  : JSON.stringify(inputs.deletedBy || {}, null, 2)
              }
              onChange={(value) => {
                try {
                  const parsed = JSON.parse(value)
                  handleChange('deletedBy', parsed)
                } catch {
                  handleChange('deletedBy', value)
                }
              }}
              language={CodeLanguage.json}
              readOnly={false}
              minHeight={100}
            />
            {errors.deletedBy && (
              <p className='text-sm text-destructive mt-1'>{errors.deletedBy}</p>
            )}
          </Field>
        )}
      </div>
    </Section>
  )
}
