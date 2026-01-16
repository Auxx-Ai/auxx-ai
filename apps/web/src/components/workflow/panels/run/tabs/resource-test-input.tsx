// apps/web/src/components/workflow/panels/run/tabs/resource-test-input.tsx

'use client'

import React, { useCallback, useEffect } from 'react'
import { api } from '~/trpc/react'
import { Button } from '@auxx/ui/components/button'

import { Loader2, AlertCircle } from 'lucide-react'
import type { ResourceId } from '@auxx/lib/workflow-engine/client'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'
import {
  toResourceId,
  getInstanceId,
  type ResourceId as FieldResourceId,
} from '@auxx/lib/field-values/client'
import { CodeEditor, CodeLanguage } from '~/components/workflow/ui/code-editor'
import Field from '~/components/workflow/ui/field'
import Section from '~/components/workflow/ui/section'
import { toastError } from '@auxx/ui/components/toast'
import { VarEditorFieldRow, VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { BaseType } from '~/components/workflow/types'
import { useResourceStore } from '~/components/resources'

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
  const getResourceById = useResourceStore((s) => s.getResourceById)
  const isLoadingResources = useResourceStore((s) => s.isLoading)

  // Get resource config from provider (supports both system and custom resources)
  const resource = getResourceById(resourceType)
  console.log('ResourceTestInput render', { resourceType, resource, inputs })
  // Fetch resource data when user picks a resource
  const {
    data: selectedResource,
    isLoading: isLoadingResource,
    error: fetchError,
  } = api.resource.getById.useQuery(
    {
      entityDefinitionId: resourceType,
      id: inputs.selectedResourceId || '',
    },
    {
      enabled: !!inputs.selectedResourceId && !!resource,
      retry: 1,
    }
  )

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
        handleChange('selectedResourceId', null)
        handleChange('resourceData', {})
        return
      }

      handleChange('selectedResourceId', value.referenceId)
      // Resource data will be loaded by the query and set via useEffect
    },
    [handleChange]
  )

  // Update resourceData when selected resource loads
  useEffect(() => {
    if (selectedResource) {
      // Extract the actual resource data from the picker item wrapper
      handleChange('resourceData', selectedResource.data)
    }
  }, [selectedResource, handleChange])

  // Show error toast if resource fetch fails
  useEffect(() => {
    if (fetchError) {
      toastError({
        title: 'Failed to load resource',
        description: fetchError.message || 'The selected resource could not be loaded',
      })
      handleChange('selectedResourceId', null)
    }
  }, [fetchError, handleChange])

  // Show loading state while resources load
  if (isLoadingResources) {
    return (
      <Section title="Resource Trigger" initialOpen>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading resource configuration...
        </div>
      </Section>
    )
  }

  // Validate resource type exists
  if (!resource) {
    return (
      <Section title="Resource Trigger" initialOpen>
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          Invalid resource type: {resourceType}
        </div>
      </Section>
    )
  }

  return (
    <>
      <Section title={`${resource.label} ${operation}`} initialOpen>
        <div className="space-y-4">
          {/* Resource Picker Mode */}
          <VarEditorField>
            <VarEditorFieldRow
              className="p-0"
              title="Resource"
              description={`Select the ${resource.label.toLowerCase()} by type or ID to ${operation === 'created' ? 'create' : operation === 'updated' ? 'update' : 'delete'}`}
              type={BaseType.RELATION}
              isRequired
              validationError={errors.resourceData}
              validationType={errors.resourceData ? 'error' : undefined}>
              <MultiRelationInput
                className="flex-1"
                entityDefinitionId={resourceType}
                value={
                  inputs.selectedResourceId
                    ? [toResourceId(resourceType, inputs.selectedResourceId)]
                    : []
                }
                onChange={(resourceIds: FieldResourceId[]) =>
                  handleResourceSelect(
                    resourceIds[0] ? { referenceId: getInstanceId(resourceIds[0]) } : null
                  )
                }
                multi={false}
              />
            </VarEditorFieldRow>
          </VarEditorField>
          {/* Loading indicator */}
          {isLoadingResource && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground px-4">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading resource data...
            </div>
          )}
          {/* Resource preview */}
          {selectedResource && !isLoadingResource && (
            <div className="rounded-md border border-border bg-muted/50 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Selected: {resource.label}</div>
                <Button variant="ghost" size="sm" onClick={() => handleResourceSelect(null)}>
                  Clear
                </Button>
              </div>
              <pre className="mt-2 text-xs text-muted-foreground max-h-32 overflow-auto">
                {JSON.stringify(selectedResource, null, 2)}
              </pre>
            </div>
          )}
          {/* Operation-specific fields */}
          {operation === 'updated' && (
            <>
              <Field
                title="Changed Fields"
                description="Array of field names that were changed. List the fields that were modified in this update">
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
                  <p className="text-sm text-destructive mt-1">{errors.changedFields}</p>
                )}
              </Field>

              <Field
                title="Previous Values"
                description="Object containing previous values of changed fields. The values these fields had before the update">
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
                  <p className="text-sm text-destructive mt-1">{errors.previousValues}</p>
                )}
              </Field>
            </>
          )}
          {operation === 'deleted' && (
            <Field
              title="Deleted By"
              description="Information about the user who deleted this resource. User object with id, email, and name">
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
                <p className="text-sm text-destructive mt-1">{errors.deletedBy}</p>
              )}
            </Field>
          )}
        </div>
      </Section>
    </>
  )
}
