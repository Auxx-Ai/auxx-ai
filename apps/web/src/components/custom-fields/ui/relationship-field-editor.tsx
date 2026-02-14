// apps/web/src/components/custom-fields/ui/relationship-field-editor.tsx

'use client'

import {
  RELATIONSHIP_TYPES as RELATIONSHIP_TYPE_VALUES,
  type RelationshipConfig,
  type RelationshipOptions,
} from '@auxx/types/custom-field'
import { parseResourceFieldId } from '@auxx/types/field'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { getInverseCardinality, isSingleRelationship } from '@auxx/utils'
import { useResource, useResources } from '~/components/resources'

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

/** Props for create mode - creating a new relationship field */
interface CreateModeProps {
  mode: 'create'
  /** Options for creating a new relationship */
  options: RelationshipOptions
  /** Callback when options change */
  onChange: (options: RelationshipOptions) => void
}

/** Props for edit mode - editing an existing relationship field */
interface EditModeProps {
  mode: 'edit'
  /** Stored relationship config from the existing field */
  storedConfig: RelationshipConfig
  /** Current inverse name (editable) */
  inverseName: string
  /** Callback when inverse name changes */
  onInverseNameChange: (name: string) => void
}

/** Common props shared by both modes */
interface CommonProps {
  /** Entity definition ID of the current resource */
  entityDefinitionId: string
  /** Field name value from parent form */
  name: string
  /** Callback to update field name in parent form */
  onNameChange: (value: string) => void
}

type RelationshipFieldEditorProps = CommonProps & (CreateModeProps | EditModeProps)

/**
 * 3-column editor component for configuring RELATIONSHIP field options.
 * Shows current entity field, relationship type, and inverse field side-by-side.
 *
 * Supports two modes:
 * - Create mode: All fields editable, user configures relationship from scratch
 * - Edit mode: Related resource and relationship type are read-only (can't change cardinality)
 */
export function RelationshipFieldEditor(props: RelationshipFieldEditorProps) {
  const { entityDefinitionId, name, onNameChange } = props
  const isEditMode = props.mode === 'edit'

  // Get all resources for the dropdown (only needed in create mode)
  const { resources, isLoading } = useResources()

  // Get current resource (where this field lives)
  const { resource: currentResource } = useResource(entityDefinitionId)

  // In edit mode, derive relatedResourceId from stored config's inverseResourceFieldId
  const relatedResourceId = isEditMode
    ? props.storedConfig.inverseResourceFieldId
      ? parseResourceFieldId(props.storedConfig.inverseResourceFieldId).entityDefinitionId
      : undefined
    : props.options.relatedResourceId

  // Get the related resource
  const { resource: selectedResource } = useResource(relatedResourceId)

  // Get current relationship type
  const relationshipType = isEditMode
    ? props.storedConfig.relationshipType
    : props.options.relationshipType

  // Get inverse name (from props in edit mode, from options in create mode)
  const inverseName = isEditMode ? props.inverseName : props.options.inverseName

  /** Update a single option field (create mode only) */
  const updateOption = <K extends keyof RelationshipOptions>(
    key: K,
    value: RelationshipOptions[K]
  ) => {
    if (!isEditMode) {
      props.onChange({ ...props.options, [key]: value })
    }
  }

  /**
   * Get placeholder for the left (current entity) field name input.
   * Based on the RELATED resource and relationship type.
   */
  const getLeftPlaceholder = () => {
    if (!selectedResource) return 'Field name...'
    return isSingleRelationship(relationshipType) ? selectedResource.label : selectedResource.plural
  }

  /**
   * Get placeholder for the right (inverse) field name input.
   * Based on the CURRENT resource and inverse relationship type.
   */
  const getRightPlaceholder = () => {
    if (!currentResource) return 'Field name...'
    const inverseType = getInverseCardinality(relationshipType)
    return isSingleRelationship(inverseType) ? currentResource.label : currentResource.plural
  }

  return (
    <div className='grid grid-cols-[1fr_auto_1fr] gap-4 items-start'>
      {/* LEFT: Current entity field */}
      <Card>
        <CardHeader className='p-0 border-b'>
          <CardTitle className='text-sm font-medium h-8 flex items-center ps-4'>
            {currentResource?.plural || 'This Entity'}
          </CardTitle>
        </CardHeader>
        <CardContent className='pt-3'>
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={`e.g. ${getLeftPlaceholder()}`}
          />
          <Label className='font-normal ps-2 mt-2 text-sm text-primary-400'>
            Associated attribute name
          </Label>
        </CardContent>
      </Card>

      {/* MIDDLE: Relationship type selector */}
      <div className='flex items-center h-full'>
        <Select
          value={relationshipType}
          onValueChange={(v) =>
            updateOption('relationshipType', v as RelationshipOptions['relationshipType'])
          }
          disabled={isEditMode}>
          <SelectTrigger className='w-[140px]'>
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
        <CardHeader className='p-0 border-b'>
          {isEditMode ? (
            /* Edit mode: show related resource as read-only */
            <div className='flex items-center gap-2 h-8 ps-4'>
              {selectedResource?.icon && (
                <EntityIcon
                  iconId={selectedResource.icon}
                  color={selectedResource.color || 'gray'}
                  className='size-5'
                />
              )}
              <span className='text-sm font-medium'>{selectedResource?.label || 'Unknown'}</span>
            </div>
          ) : (
            /* Create mode: show resource selector */
            <Select
              value={props.options.relatedResourceId}
              onValueChange={(v) => updateOption('relatedResourceId', v)}
              disabled={isLoading}>
              <SelectTrigger className='mb-0' variant='transparent' size='default'>
                <SelectValue placeholder='Select resource...' />
              </SelectTrigger>
              <SelectContent>
                {resources.map((resource) => (
                  <SelectItem key={resource.id} value={resource.id}>
                    <div className='flex items-center gap-2'>
                      {resource.icon && (
                        <EntityIcon
                          iconId={resource.icon}
                          color={resource.color || 'gray'}
                          className='size-5'
                        />
                      )}
                      <span>{resource.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardHeader>
        <CardContent className='pt-3'>
          {isEditMode ? (
            /* Edit mode: editable inverse field name */
            <Input
              value={inverseName}
              onChange={(e) => props.onInverseNameChange(e.target.value)}
              placeholder='Inverse field name'
            />
          ) : (
            /* Create mode: editable inverse field name */
            <Input
              value={inverseName}
              onChange={(e) => updateOption('inverseName', e.target.value)}
              placeholder={`e.g. ${getRightPlaceholder()}`}
            />
          )}
          <Label className='font-normal ps-2 mt-2 text-sm text-primary-400'>
            Associated attribute name
          </Label>
        </CardContent>
      </Card>
    </div>
  )
}
