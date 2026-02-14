// apps/web/src/components/data-import/column-mapping/field-picker.tsx

'use client'

import type { ImportableField } from '@auxx/lib/import'
import type { BaseType } from '@auxx/lib/workflow-engine'
import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { EntityIcon } from '@auxx/ui/components/icons'
import { PopoverContent } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Ban, Check, ChevronLeft, ChevronRight, Hash, Type } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useResource, useResourceFields } from '~/components/resources'
import { VarTypeIcon } from '~/components/workflow/utils/icon-helper'

interface FieldPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fields: ImportableField[]
  value: string | null
  onChange: (fieldKey: string | null, matchField?: string) => void
  /** Currently selected match field for relationships */
  matchField?: string | null
  /** Field keys already used by other columns */
  usedFieldKeys?: string[]
  className?: string
}

/**
 * Flat field picker with relationship drill-down for match field selection.
 * Shows all fields at root level with EntityIcon for relationships.
 */
export function FieldPicker({
  open,
  onOpenChange,
  fields,
  value,
  onChange,
  matchField,
  usedFieldKeys = [],
  className,
}: FieldPickerProps) {
  const [search, setSearch] = useState('')
  const [relationshipContext, setRelationshipContext] = useState<{
    fieldKey: string
    fieldLabel: string
    relatedEntityDefinitionId: string
  } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Get target resource info for icon display
  const { resource: targetResource } = useResource(
    relationshipContext?.relatedEntityDefinitionId ?? null
  )

  // For relationship navigation - get target resource fields
  const { filterableFields: targetFields } = useResourceFields(
    relationshipContext?.relatedEntityDefinitionId ?? null
  )

  // Separate fields: identifiers first, then scalar, then relationships
  const { identifierFields, scalarFields, relationFields } = useMemo(() => {
    return {
      identifierFields: fields.filter((f) => f.isIdentifier),
      scalarFields: fields.filter((f) => !f.isIdentifier && !f.isRelation),
      relationFields: fields.filter((f) => f.isRelation),
    }
  }, [fields])

  // Filter by search
  const filteredFields = useMemo(() => {
    if (!search) return { identifierFields, scalarFields, relationFields }
    const searchLower = search.toLowerCase()
    const filter = (f: ImportableField) =>
      f.label.toLowerCase().includes(searchLower) || f.key.toLowerCase().includes(searchLower)
    return {
      identifierFields: identifierFields.filter(filter),
      scalarFields: scalarFields.filter(filter),
      relationFields: relationFields.filter(filter),
    }
  }, [search, identifierFields, scalarFields, relationFields])

  // Matchable fields for relationship (exclude relations from target)
  const matchableFields = useMemo(() => {
    return targetFields
      .filter((f) => !f.relationship)
      .map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
      }))
  }, [targetFields])

  // Navigation handlers
  const navigateToRelationship = (field: ImportableField) => {
    setRelationshipContext({
      fieldKey: field.key,
      fieldLabel: field.label,
      relatedEntityDefinitionId: field.relationConfig?.relatedEntityDefinitionId ?? '',
    })
    setSearch('')
    contentRef.current?.scrollTo(0, 0)
  }

  const navigateBack = () => {
    setRelationshipContext(null)
  }

  // Selection handlers
  const selectField = (field: ImportableField) => {
    if (field.isRelation && field.relationConfig?.relatedEntityDefinitionId) {
      navigateToRelationship(field)
      return
    }
    onChange(field.key)
    onOpenChange(false)
  }

  const selectMatchField = (matchFieldKey: string) => {
    if (relationshipContext) {
      onChange(relationshipContext.fieldKey, matchFieldKey)
    }
    onOpenChange(false)
  }

  const skipColumn = () => {
    onChange(null)
    onOpenChange(false)
  }

  // Reset on close, restore relationship context on open
  useEffect(() => {
    if (!open) {
      setRelationshipContext(null)
      setSearch('')
    } else {
      // On open: if current value is a relationship with matchField, navigate to it
      if (value && matchField) {
        const selectedField = fields.find((f) => f.key === value)
        if (selectedField?.isRelation && selectedField.relationConfig?.relatedEntityDefinitionId) {
          setRelationshipContext({
            fieldKey: selectedField.key,
            fieldLabel: selectedField.label,
            relatedEntityDefinitionId: selectedField.relationConfig.relatedEntityDefinitionId,
          })
        }
      }
    }
  }, [open, value, matchField, fields])

  // Get icon for field based on type
  const getFieldIcon = (field: ImportableField) => {
    if (field.isIdentifier) return <Hash className='h-4 w-4 text-muted-foreground' />
    return <Type className='h-4 w-4 text-muted-foreground' />
  }

  // Render field item
  const renderFieldItem = (field: ImportableField) => {
    const isSelected = value === field.key
    const isUsed = usedFieldKeys.includes(field.key) && !isSelected

    return (
      <CommandItem
        key={field.key}
        onSelect={() => selectField(field)}
        className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          {isSelected ? (
            <Check className='' />
          ) : field.isRelation && field.relationConfig ? (
            <RelationFieldIcon
              relatedEntityDefinitionId={field.relationConfig.relatedEntityDefinitionId}
            />
          ) : (
            getFieldIcon(field)
          )}
          <span>{field.label}</span>
          {field.required && <span className='text-destructive'>*</span>}
        </div>
        <div className='flex items-center gap-1'>
          {isUsed && <span className='text-xs text-muted-foreground'>will replace</span>}
          {field.isRelation && <ChevronRight className='h-4 w-4 opacity-50' />}
        </div>
      </CommandItem>
    )
  }
  const hasAnyFields =
    filteredFields.identifierFields.length > 0 ||
    filteredFields.scalarFields.length > 0 ||
    filteredFields.relationFields.length > 0

  return (
    <PopoverContent className={cn('w-[320px] p-0', className)} ref={contentRef} align='start'>
      <Command shouldFilter={false}>
        <CommandInput
          placeholder={relationshipContext ? 'Search match fields...' : 'Search fields...'}
          value={search}
          onValueChange={setSearch}
        />

        <CommandList>
          {/* Breadcrumb for relationship context */}
          {relationshipContext && (
            <div className='flex items-center border-b px-2 py-1.5 text-sm'>
              <Button variant='ghost' size='icon-xs' onClick={navigateBack}>
                <ChevronLeft />
              </Button>
              <div className='flex items-center gap-1 text-muted-foreground'>
                {targetResource && (
                  <EntityIcon
                    iconId={targetResource.icon}
                    color={'color' in targetResource ? targetResource.color : undefined}
                    size='xs'
                  />
                )}
                <span className='font-medium text-foreground'>
                  {relationshipContext.fieldLabel}
                </span>
                <ChevronRight className='h-3.5 w-3.5 opacity-50 shrink-0' />
                <span>Select match field</span>
              </div>
            </div>
          )}

          {/* Instruction for match field selection */}
          {relationshipContext && (
            <div className='border-b bg-muted/50 px-3 py-2 text-xs text-muted-foreground'>
              Choose which field in the target to match CSV values against
            </div>
          )}

          {/* Root level - all fields flat */}
          {!relationshipContext && (
            <>
              <CommandGroup>
                {/* Skip option */}
                <CommandItem
                  onSelect={skipColumn}
                  className='flex items-center gap-2 text-muted-foreground'>
                  <Ban />
                  <span>Skip this column</span>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />

              {/* Identifier fields */}
              {filteredFields.identifierFields.length > 0 && (
                <CommandGroup heading='Identifiers'>
                  {filteredFields.identifierFields.map(renderFieldItem)}
                </CommandGroup>
              )}

              {/* Scalar fields */}
              {filteredFields.scalarFields.length > 0 && (
                <CommandGroup heading='Fields'>
                  {filteredFields.scalarFields.map(renderFieldItem)}
                </CommandGroup>
              )}

              {/* Relationship fields */}
              {filteredFields.relationFields.length > 0 && (
                <CommandGroup heading='Relationships'>
                  {filteredFields.relationFields.map(renderFieldItem)}
                </CommandGroup>
              )}

              {!hasAnyFields && <CommandEmpty>No fields found.</CommandEmpty>}
            </>
          )}

          {/* Match field selection for relationship */}
          {relationshipContext && (
            <CommandGroup>
              {matchableFields.length === 0 ? (
                <CommandEmpty>No matchable fields found.</CommandEmpty>
              ) : (
                matchableFields.map((field) => {
                  const isSelected = matchField === field.key
                  const isRecommended = ['id', 'email', 'externalId', 'name'].includes(field.key)
                  return (
                    <CommandItem
                      key={field.key}
                      onSelect={() => selectMatchField(field.key)}
                      className='flex items-center justify-between'>
                      <div className='flex items-center gap-2'>
                        {isSelected && <Check className='' />}
                        {!isSelected && (
                          <VarTypeIcon
                            type={field.type as BaseType}
                            className='text-muted-foreground'
                          />
                        )}
                        <span>{field.label}</span>
                      </div>
                      {isRecommended && (
                        <span className='text-xs text-muted-foreground'>recommended</span>
                      )}
                    </CommandItem>
                  )
                })
              )}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </PopoverContent>
  )
}

/**
 * Component to render EntityIcon for relationship fields.
 * Fetches target resource to display its icon.
 */
function RelationFieldIcon({ relatedEntityDefinitionId }: { relatedEntityDefinitionId: string }) {
  const { resource } = useResource(relatedEntityDefinitionId)

  if (!resource) {
    return <Type className='h-4 w-4 text-muted-foreground' />
  }

  return (
    <EntityIcon
      iconId={resource.icon}
      color={'color' in resource ? resource.color : undefined}
      size='xs'
      className='text-muted-foreground'
    />
  )
}
