// apps/web/src/components/custom-fields/ui/relationship-field-editor.tsx

'use client'

import { Input } from '@auxx/ui/components/input'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Label } from '@auxx/ui/components/label'
import { EntityIcon } from '@auxx/ui/components/icons'
import {
  RELATIONSHIP_TYPES as RELATIONSHIP_TYPE_VALUES,
  type RelationshipOptions,
} from '@auxx/types/custom-field'
import { isSingleRelationship, getInverseCardinality } from '@auxx/utils'
import { useResources, useResource } from '~/components/resources'

// Re-export RelationshipOptions for consumers of this component
export type { RelationshipOptions }

/** Relationship cardinality options for UI display */
const RELATIONSHIP_TYPES = RELATIONSHIP_TYPE_VALUES.map((value) => ({
  value,
  label: value
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' '),
}))

interface RelationshipFieldEditorProps {
  options: RelationshipOptions
  onChange: (options: RelationshipOptions) => void
  /** Entity definition ID to look up current resource in resources list */
  entityDefinitionId?: string
  /** Field name value from parent form */
  name?: string
  /** Callback to update field name in parent form */
  onNameChange?: (value: string) => void
}

/**
 * 3-column editor component for configuring RELATIONSHIP field options
 * Shows current entity field, relationship type, and inverse field side-by-side
 */
export function RelationshipFieldEditor({
  options,
  onChange,
  entityDefinitionId,
  name,
  onNameChange,
}: RelationshipFieldEditorProps) {
  // Get all resources for the dropdown
  const { resources, isLoading } = useResources()

  // Get current and selected resources
  const { resource: currentResource } = useResource(entityDefinitionId)
  const { resource: selectedResource } = useResource(options.relatedResourceId)

  console.log('RelationshipFieldEditor options:', currentResource, selectedResource, options)

  /** Update a single option field */
  const updateOption = <K extends keyof RelationshipOptions>(
    key: K,
    value: RelationshipOptions[K]
  ) => {
    onChange({ ...options, [key]: value })
  }

  /**
   * Get placeholder for the left (current entity) field name input
   * Based on the RELATED resource and relationship type
   */
  const getLeftPlaceholder = () => {
    if (!selectedResource) return 'Field name...'
    return isSingleRelationship(options.relationshipType)
      ? selectedResource.label
      : selectedResource.plural
  }

  /**
   * Get placeholder for the right (inverse) field name input
   * Based on the CURRENT resource and inverse relationship type
   */
  const getRightPlaceholder = () => {
    if (!currentResource) return 'Field name...'
    const inverseType = getInverseCardinality(options.relationshipType)
    return isSingleRelationship(inverseType) ? currentResource.label : currentResource.plural
  }

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start">
      {/* LEFT: Current entity field grid-cols-[1fr,auto,1fr] */}
      <Card>
        <CardHeader className="p-0 border-b">
          <CardTitle className="text-sm font-medium h-8 flex items-center ps-4">
            {currentResource?.plural || 'This Entity'}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <Input
            value={name || ''}
            onChange={(e) => onNameChange?.(e.target.value)}
            placeholder={`e.g. ${getLeftPlaceholder()}`}
          />
          <Label className="font-normal ps-2 mt-2 text-sm text-primary-400">
            Associated attribute name
          </Label>
        </CardContent>
      </Card>

      {/* MIDDLE: Relationship type selector */}
      <div className="flex items-center h-full">
        <Select
          value={options.relationshipType}
          onValueChange={(v) =>
            updateOption('relationshipType', v as RelationshipOptions['relationshipType'])
          }>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RELATIONSHIP_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* RIGHT: Related entity + inverse field */}
      <Card>
        <CardHeader className="p-0 border-b">
          <Select
            value={options.relatedResourceId}
            onValueChange={(v) => updateOption('relatedResourceId', v)}
            disabled={isLoading}>
            <SelectTrigger className="mb-0" variant="transparent" size="default">
              <SelectValue placeholder="Select resource..." />
            </SelectTrigger>
            <SelectContent>
              {resources.map((resource) => (
                <SelectItem key={resource.id} value={resource.id}>
                  <div className="flex items-center gap-2">
                    {resource.icon && (
                      <EntityIcon
                        iconId={resource.icon}
                        color={resource.color || 'gray'}
                        className="size-5"
                      />
                    )}
                    <span>{resource.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="pt-3">
          <Input
            value={options.inverseName}
            onChange={(e) => updateOption('inverseName', e.target.value)}
            placeholder={`e.g. ${getRightPlaceholder()}`}
          />
          <Label className="font-normal ps-2 mt-2 text-sm text-primary-400">
            Associated attribute name
          </Label>
        </CardContent>
      </Card>
    </div>
  )
}
