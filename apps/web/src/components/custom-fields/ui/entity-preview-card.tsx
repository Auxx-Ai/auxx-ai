// apps/web/src/components/custom-fields/ui/entity-preview-card.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import type { ConflictResolution } from '@auxx/lib/entity-templates'
import type { Resource } from '@auxx/lib/resources/client'
import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { EntityIcon } from '@auxx/ui/components/icons'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { cn } from '@auxx/ui/lib/utils'
import { Link2, Pencil, Plus, RotateCcw, Trash2, Undo2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

export interface FieldState {
  /** Renamed field name (null = use original) */
  customName: string | null
  /** Whether the field has been soft-deleted */
  removed: boolean
}

interface EntityPreviewCardProps {
  template: {
    id: string
    entity: { icon: string; color: string; singular: string; plural: string; apiSlug: string }
    fields: Array<{
      templateFieldId: string
      name: string
      type: string
      relationship?: { relatedResourceId?: string | null } | null
    }>
  }
  /** Primary card — always included, no checkbox */
  primary?: boolean
  /** Whether this companion card is selected */
  selected?: boolean
  /** Template IDs that are currently selected (used to auto-disable relationship fields targeting deselected companions) */
  selectedTemplateIds?: Set<string>
  /** Toggle selection callback (companion cards only) */
  onToggle?: () => void
  /** Called when user modifies fields (renames/removes). Fires on every change. */
  onFieldModifications?: (templateId: string, modifications: Record<string, FieldState>) => void
  /** Whether any card in the set has a conflict (for vertical alignment) */
  hasAnyConflict?: boolean
  /** The existing resource that conflicts with this template */
  conflictingResource?: Resource | null
  /** Current conflict resolution choice */
  conflictResolution?: ConflictResolution
  /** Callback when user changes conflict resolution */
  onConflictResolutionChange?: (resolution: ConflictResolution) => void
  /** New relationship fields that will be added to an existing entity (for "use-existing" mode) */
  newRelationshipFields?: Array<{
    templateFieldId: string
    name: string
    type: string
  }>
}

/** Preview card showing entity icon + field list with inline editing */
const TEMPLATE_REF_PREFIX = '@template:'

export function EntityPreviewCard({
  template,
  primary,
  selected,
  selectedTemplateIds,
  onToggle,
  onFieldModifications,
  hasAnyConflict,
  conflictingResource,
  conflictResolution,
  onConflictResolutionChange,
  newRelationshipFields,
}: EntityPreviewCardProps) {
  const [fieldStates, setFieldStates] = useState<Record<string, FieldState>>({})
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
  const lastReportedRef = useRef<string>('')

  const isUseExisting = conflictingResource && conflictResolution === 'use-existing'

  /** Fields whose @template:* target is not in the selected set — serialized for stability */
  const disabledFieldIdsKey = useMemo(() => {
    if (!selectedTemplateIds || isUseExisting) return ''
    const disabled: string[] = []
    for (const field of template.fields) {
      const ref = field.relationship?.relatedResourceId
      if (ref && ref.startsWith(TEMPLATE_REF_PREFIX)) {
        const targetTemplateId = ref.slice(TEMPLATE_REF_PREFIX.length)
        if (!selectedTemplateIds.has(targetTemplateId)) {
          disabled.push(field.templateFieldId)
        }
      }
    }
    return disabled.sort().join(',')
  }, [template.fields, selectedTemplateIds, isUseExisting])

  const disabledFieldIds = useMemo(
    () => new Set(disabledFieldIdsKey ? disabledFieldIdsKey.split(',') : []),
    [disabledFieldIdsKey]
  )

  useEffect(() => {
    // Don't report field modifications for "use-existing" cards — handled by linkedEntities
    if (isUseExisting) return

    // Merge user field states with auto-disabled fields
    const merged = { ...fieldStates }
    for (const fieldId of disabledFieldIds) {
      merged[fieldId] = { customName: merged[fieldId]?.customName ?? null, removed: true }
    }

    // Only notify parent if data actually changed
    const key = JSON.stringify(merged)
    if (key === lastReportedRef.current) return
    lastReportedRef.current = key

    onFieldModifications?.(template.id, merged)
  }, [fieldStates, disabledFieldIds, template.id, onFieldModifications, isUseExisting])

  function handleStartEdit(fieldId: string) {
    setEditingFieldId(fieldId)
  }

  function handleFinishEdit(fieldId: string, newName: string) {
    setEditingFieldId(null)
    if (newName.trim() === '') return
    setFieldStates((prev) => ({
      ...prev,
      [fieldId]: { customName: newName, removed: prev[fieldId]?.removed ?? false },
    }))
  }

  function handleCancelEdit() {
    setEditingFieldId(null)
  }

  function handleRevertName(fieldId: string) {
    setFieldStates((prev) => ({
      ...prev,
      [fieldId]: { customName: null, removed: prev[fieldId]?.removed ?? false },
    }))
  }

  function handleToggleRemove(fieldId: string) {
    setFieldStates((prev) => ({
      ...prev,
      [fieldId]: {
        customName: prev[fieldId]?.customName ?? null,
        removed: !(prev[fieldId]?.removed ?? false),
      },
    }))
  }

  return (
    <div data-slot='preview-card' className='shrink-0'>
      {/* Banner spacer — ensures vertical alignment when any card has a conflict */}
      {hasAnyConflict && (
        <div className='mb-1.5' style={{ height: conflictingResource ? undefined : 42 }}>
          {conflictingResource && onConflictResolutionChange && (
            <div className='flex items-center gap-2 border border-amber-200 bg-amber-50 dark:bg-amber-300/10 dark:border-amber-200/30 rounded-xl px-2 py-1'>
              <span className='text-xs text-amber-700 font-medium whitespace-nowrap shrink-0'>
                Already exists
              </span>
              <RadioTab
                value={conflictResolution ?? 'use-existing'}
                onValueChange={(v) =>
                  onConflictResolutionChange(v as 'use-existing' | 'create-new')
                }
                size='sm'
                radioGroupClassName='grid w-full after:bg-amber-200 after:shadow-none after:rounded-xl after:px-1 after:dark:bg-amber-200/30'
                className=' flex flex-1 bg-transparent'>
                <RadioTabItem value='use-existing' size='sm' className='px-1'>
                  Use Existing
                </RadioTabItem>
                <RadioTabItem value='create-new' size='sm' className='px-1'>
                  Create New
                </RadioTabItem>
              </RadioTab>
            </div>
          )}
        </div>
      )}

      <div
        className={cn(
          'rounded-2xl border p-3 w-xs relative',
          isUseExisting
            ? 'bg-amber-50 dark:bg-amber-200/10 border-amber-200 dark:border-amber-200/30'
            : primary
              ? 'bg-primary-50'
              : selected
                ? 'bg-primary-50'
                : 'bg-muted/50 opacity-60'
        )}>
        {/* Checkbox in upper right for companion cards (visual only) — hidden in use-existing mode */}
        {!primary && !isUseExisting && (
          <div className='absolute top-2.5 right-2.5 pointer-events-none'>
            <Checkbox checked={selected} tabIndex={-1} />
          </div>
        )}

        {/* Link icon for use-existing mode */}
        {isUseExisting && (
          <div className='absolute top-2.5 right-2.5'>
            <Link2 className='size-4 text-amber-600' />
          </div>
        )}

        {/* Header — clickable for companion toggle (not in use-existing mode) */}
        <div
          onClick={!primary && !isUseExisting ? onToggle : undefined}
          className={cn(
            'flex items-center gap-2 mb-3',
            !primary && !isUseExisting && 'cursor-pointer'
          )}>
          <EntityIcon
            iconId={isUseExisting ? conflictingResource.icon : template.entity.icon}
            color={isUseExisting ? conflictingResource.color : template.entity.color}
            size='default'
            inverse
            className='inset-shadow-xs inset-shadow-black/20'
          />
          <div>
            <h3 className='text-sm font-semibold'>
              {isUseExisting ? conflictingResource.label : template.entity.singular}
            </h3>
            <p className='text-xs text-muted-foreground'>
              {isUseExisting ? (
                <>
                  {conflictingResource.fields.length} existing fields
                  {newRelationshipFields && newRelationshipFields.length > 0 && (
                    <span className='text-green-600'> + {newRelationshipFields.length} new</span>
                  )}
                </>
              ) : (
                <>
                  {template.entity.plural} &middot;{' '}
                  {template.fields.length -
                    Object.values(fieldStates).filter((s) => s.removed).length -
                    [...disabledFieldIds].filter((id) => !fieldStates[id]?.removed).length}{' '}
                  fields
                </>
              )}
            </p>
          </div>
        </div>

        {/* Field list */}
        <div className='space-y-1'>
          {isUseExisting ? (
            <>
              {/* Show existing fields as read-only */}
              {conflictingResource.fields
                .filter((f) => !f.isSystem)
                .map((field) => (
                  <div
                    key={field.id}
                    className='flex h-7 items-center gap-1 rounded-md bg-amber-100 dark:bg-amber-300/10 px-2'>
                    <span className='text-sm text-muted-foreground'>{field.label}</span>
                    <div className='flex items-center gap-1 text-xs text-muted-foreground/60 ml-auto'>
                      <EntityIcon
                        iconId={
                          field.fieldType
                            ? (fieldTypeOptions[field.fieldType]?.iconId ?? 'circle')
                            : 'circle'
                        }
                        variant='default'
                        size='default'
                      />
                      <span>
                        {field.fieldType
                          ? (fieldTypeOptions[field.fieldType]?.label ?? field.type)
                          : field.type}
                      </span>
                    </div>
                  </div>
                ))}
              {/* New relationship fields highlighted */}
              {newRelationshipFields?.map((field) => (
                <div
                  key={field.templateFieldId}
                  className='flex h-7 items-center gap-1 rounded-md bg-green-50 border border-green-200 px-2'>
                  <span className='text-sm text-green-700'>+ {field.name}</span>
                  <div className='flex items-center gap-1 text-xs text-green-600/70 ml-auto'>
                    <Link2 className='size-3' />
                    <span>Relationship</span>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              {/* "Create New" banner hint */}
              {conflictingResource && conflictResolution === 'create-new' && (
                <div className='text-xs text-amber-600 mb-1 px-1'>
                  Will be created as{' '}
                  <code className='bg-amber-50 px-1 rounded dark:bg-amber-500/15'>
                    {template.entity.apiSlug}-2
                  </code>
                </div>
              )}
              {template.fields.map((field) => (
                <TemplateFieldRow
                  key={field.templateFieldId}
                  field={field}
                  fieldState={fieldStates[field.templateFieldId]}
                  isEditing={editingFieldId === field.templateFieldId}
                  isDisabled={disabledFieldIds.has(field.templateFieldId)}
                  onStartEdit={() => handleStartEdit(field.templateFieldId)}
                  onFinishEdit={(newName) => handleFinishEdit(field.templateFieldId, newName)}
                  onCancelEdit={handleCancelEdit}
                  onToggleRemove={() => handleToggleRemove(field.templateFieldId)}
                  onRevertName={() => handleRevertName(field.templateFieldId)}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

interface TemplateFieldRowProps {
  field: { templateFieldId: string; name: string; type: string }
  fieldState: FieldState | undefined
  isEditing: boolean
  /** Auto-disabled because relationship target template is deselected */
  isDisabled: boolean
  /** Whether this row is inside a "use-existing" conflict card */
  isUseExisting?: boolean
  onStartEdit: () => void
  onFinishEdit: (newName: string) => void
  onCancelEdit: () => void
  onToggleRemove: () => void
  onRevertName: () => void
}

function TemplateFieldRow({
  field,
  fieldState,
  isEditing,
  isDisabled,
  isUseExisting,
  onStartEdit,
  onFinishEdit,
  onCancelEdit,
  onToggleRemove,
  onRevertName,
}: TemplateFieldRowProps) {
  const inputRef = useRef<AutosizeInputRef>(null)
  const [editValue, setEditValue] = useState('')
  const isRemoved = isDisabled || (fieldState?.removed ?? false)
  const isRenamed = fieldState?.customName != null && fieldState.customName !== field.name
  const displayName = fieldState?.customName ?? field.name

  const fieldTypeOption = fieldTypeOptions[field.type as FieldType]
  const iconId = fieldTypeOption?.iconId ?? 'circle'
  const label = fieldTypeOption?.label ?? field.type

  useEffect(() => {
    if (isEditing) {
      setEditValue(displayName)
      // Delay to ensure input is mounted
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [isEditing, displayName])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      onFinishEdit(editValue)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancelEdit()
    }
  }

  return (
    <div
      className={cn(
        'group relative flex h-7 items-center gap-1 rounded-md px-2 transition-opacity',
        isUseExisting ? 'bg-amber-50 dark:bg-amber-300/10' : 'bg-primary-100',
        isRemoved && 'opacity-50'
      )}>
      <div className='flex flex-row justify-between w-full items-center'>
        {isEditing ? (
          <AutosizeInput
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => onFinishEdit(editValue)}
            onKeyDown={handleKeyDown}
            inputClassName='text-sm text-foreground bg-transparent outline-none'
            minWidth={40}
            maxWidth={180}
          />
        ) : (
          <span
            className={cn(
              'text-sm',
              isRenamed ? 'text-purple-600' : 'text-foreground',
              isRemoved && 'line-through'
            )}>
            {displayName}
          </span>
        )}

        {/* Type icon/label — fades out on hover, hidden when removed */}
        {!isRemoved && !isEditing && (
          <div className='flex items-center gap-1 text-xs text-muted-foreground opacity-100 group-hover:opacity-0 transition-opacity duration-150'>
            <EntityIcon iconId={iconId} variant='default' size='default' />
            <span>{label}</span>
          </div>
        )}

        {/* Action buttons — absolute, always visible when removed, fade in on hover otherwise */}
        {!isDisabled && (
          <div
            className={cn(
              'absolute right-1 flex items-center gap-0.5 transition-opacity duration-150',
              isRemoved || isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}>
            {!isRemoved && isEditing && (
              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation()
                  onCancelEdit()
                }}
                className='size-5.5 flex items-center justify-center rounded hover:bg-primary-200 text-muted-foreground hover:text-foreground transition-colors'>
                <X className='size-3' />
              </button>
            )}
            {!isRemoved && !isEditing && isRenamed && (
              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation()
                  onRevertName()
                }}
                className='size-5.5 flex items-center justify-center rounded hover:bg-primary-200 text-muted-foreground hover:text-foreground transition-colors'>
                <RotateCcw className='size-3' />
              </button>
            )}
            {!isRemoved && !isEditing && (
              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation()
                  onStartEdit()
                }}
                className='size-5.5 flex items-center justify-center rounded hover:bg-primary-200 text-muted-foreground hover:text-foreground transition-colors'>
                <Pencil className='size-3' />
              </button>
            )}
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation()
                onToggleRemove()
              }}
              className='size-5.5 flex items-center justify-center rounded hover:bg-primary-200 text-muted-foreground hover:text-foreground transition-colors'>
              {isRemoved ? <Undo2 className='size-3' /> : <Trash2 className='size-3' />}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
