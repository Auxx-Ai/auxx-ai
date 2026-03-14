// apps/web/src/components/custom-fields/ui/entity-preview-card.tsx
'use client'

import type { FieldType } from '@auxx/database/types'
import { fieldTypeOptions } from '@auxx/lib/custom-fields/types'
import { AutosizeInput, type AutosizeInputRef } from '@auxx/ui/components/autosize-input'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { EntityIcon } from '@auxx/ui/components/icons'
import { cn } from '@auxx/ui/lib/utils'
import { Pencil, RotateCcw, Trash2, Undo2, X } from 'lucide-react'
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
    entity: { icon: string; color: string; singular: string; plural: string }
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
}: EntityPreviewCardProps) {
  const [fieldStates, setFieldStates] = useState<Record<string, FieldState>>({})
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)

  /** Fields whose @template:* target is not in the selected set */
  const disabledFieldIds = useMemo(() => {
    if (!selectedTemplateIds) return new Set<string>()
    const disabled = new Set<string>()
    for (const field of template.fields) {
      const ref = field.relationship?.relatedResourceId
      if (ref && ref.startsWith(TEMPLATE_REF_PREFIX)) {
        const targetTemplateId = ref.slice(TEMPLATE_REF_PREFIX.length)
        if (!selectedTemplateIds.has(targetTemplateId)) {
          disabled.add(field.templateFieldId)
        }
      }
    }
    return disabled
  }, [template.fields, selectedTemplateIds])

  useEffect(() => {
    // Merge user field states with auto-disabled fields
    const merged = { ...fieldStates }
    for (const fieldId of disabledFieldIds) {
      merged[fieldId] = { customName: merged[fieldId]?.customName ?? null, removed: true }
    }
    onFieldModifications?.(template.id, merged)
  }, [fieldStates, disabledFieldIds, template.id, onFieldModifications])

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
      <div
        className={cn(
          'rounded-2xl border p-3 w-xs relative',
          primary
            ? 'bg-primary-50 ring-2 ring-primary'
            : selected
              ? 'bg-primary-50'
              : 'bg-muted/50 opacity-60'
        )}>
        {/* Checkbox in upper right for companion cards (visual only) */}
        {!primary && (
          <div className='absolute top-2.5 right-2.5 pointer-events-none'>
            <Checkbox checked={selected} tabIndex={-1} />
          </div>
        )}

        {/* Header — clickable for companion toggle */}
        <div
          onClick={!primary ? onToggle : undefined}
          className={cn('flex items-center gap-2 mb-3', !primary && 'cursor-pointer')}>
          <EntityIcon
            iconId={template.entity.icon}
            color={template.entity.color}
            size='default'
            inverse
            className='inset-shadow-xs inset-shadow-black/20'
          />
          <div>
            <h3 className='text-sm font-semibold'>{template.entity.singular}</h3>
            <p className='text-xs text-muted-foreground'>
              {template.entity.plural} &middot;{' '}
              {template.fields.length -
                Object.values(fieldStates).filter((s) => s.removed).length -
                [...disabledFieldIds].filter((id) => !fieldStates[id]?.removed).length}{' '}
              fields
            </p>
          </div>
        </div>

        {/* Field list */}
        <div className='space-y-1'>
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
        'group relative flex h-7 items-center gap-1 rounded-md bg-primary-100 px-2 transition-opacity',
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
