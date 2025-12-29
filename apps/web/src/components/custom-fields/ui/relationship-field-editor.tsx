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
import { api } from '~/trpc/react'
import { isSystemResource, isCustomResource } from '@auxx/lib/resources/client'
import { Label } from '@auxx/ui/components/label'
import { EntityIcon } from '~/components/pickers/icon-picker'

/** Relationship cardinality options */
const RELATIONSHIP_TYPES = [
  { value: 'belongs_to', label: 'Belongs To' },
  { value: 'has_one', label: 'Has One' },
  { value: 'has_many', label: 'Has Many' },
  { value: 'many_to_many', label: 'Many to Many' },
] as const

/**
 * Relationship configuration options for the field editor
 */
export interface RelationshipOptions {
  relatedResourceId: string
  relationshipType: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
  inverseName: string
  inverseDescription?: string
  inverseIcon?: string
}

interface RelationshipFieldEditorProps {
  options: RelationshipOptions
  onChange: (options: RelationshipOptions) => void
  /** Resource ID to look up current resource in resources list */
  currentResourceId?: string
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
  currentResourceId,
  name,
  onNameChange,
}: RelationshipFieldEditorProps) {
  // Fetch all available resources (system + custom entities)
  const { data: resources, isLoading } = api.resource.getAllResourceTypes.useQuery()

  /** Update a single option field */
  const updateOption = <K extends keyof RelationshipOptions>(
    key: K,
    value: RelationshipOptions[K]
  ) => {
    onChange({ ...options, [key]: value })
  }

  // Look up both resources from the same list
  const currentResource = resources?.find((r) => r.id === currentResourceId)
  const selectedResource = resources?.find((r) => r.id === options.relatedResourceId)

  /**
   * Get placeholder for the left (current entity) field name input
   * Based on the RELATED resource and relationship type
   */
  const getLeftPlaceholder = () => {
    if (!selectedResource) return 'Field name...'
    const isSingular =
      options.relationshipType === 'belongs_to' || options.relationshipType === 'has_one'
    return isSingular ? selectedResource.label : selectedResource.plural
  }

  /**
   * Get placeholder for the right (inverse) field name input
   * Based on the CURRENT resource and relationship type
   */
  const getRightPlaceholder = () => {
    if (!currentResource) return 'Field name...'
    const isSingular =
      options.relationshipType === 'has_many' || options.relationshipType === 'has_one'
    return isSingular ? currentResource.label : currentResource.plural
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
              {/* System Resources */}
              {resources?.filter(isSystemResource).map((resource) => (
                <SelectItem key={resource.id} value={resource.id}>
                  <div className="flex items-center gap-2">
                    <span>{resource.label}</span>
                    <span className="text-xs text-muted-foreground">System</span>
                  </div>
                </SelectItem>
              ))}

              {/* Custom Entities */}
              {resources?.filter(isCustomResource).map((resource) => (
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
                    <span className="text-xs text-muted-foreground">Custom</span>
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
