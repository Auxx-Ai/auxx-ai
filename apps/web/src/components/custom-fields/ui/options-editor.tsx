// apps/web/src/components/custom-fields/ui/options-editor.tsx
'use client'

import { OPTION_COLORS, type SelectOptionColor } from '@auxx/lib/custom-fields/client'
import type { FieldOptions } from '@auxx/lib/field-values/client'
import { Button } from '@auxx/ui/components/button'
import { GripVertical, PlusCircle, Trash2 } from 'lucide-react'
import { forwardRef, useEffect, useState } from 'react'
import { OptionColorPicker } from './option-color-picker'

/** Select option type for editor state (without internal id) */
export type SelectOption = { label: string; value: string; color?: SelectOptionColor }

/**
 * Parse stored field options into editor state.
 * Handles both formats: options.options (nested) and options as array (flat).
 */
export function parseSelectOptions(fieldOptions?: FieldOptions): SelectOption[] {
  // Handle nested format (options.options)
  if (fieldOptions?.options && Array.isArray(fieldOptions.options)) {
    return fieldOptions.options.map((opt) => ({
      label: opt.label,
      value: opt.value,
      color: opt.color as SelectOptionColor | undefined,
    }))
  }
  // Handle flat format (options is array) - legacy support
  if (Array.isArray(fieldOptions)) {
    return fieldOptions.map((opt) => ({
      label: opt.label,
      value: opt.value,
      color: opt.color as SelectOptionColor | undefined,
    }))
  }
  return []
}

/**
 * Format editor state into storage format.
 * Returns options object with options key for storage.
 */
export function formatSelectOptions(options: SelectOption[]): { options: SelectOption[] } {
  return { options }
}

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { cn } from '@auxx/ui/lib/utils'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  type SyntheticListenerMap,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Option {
  label: string
  value: string
  color?: SelectOptionColor
  id: string
}

interface OptionItemProps {
  option: Option
  /** Drag handle attributes (from useSortable) */
  attributes?: React.HTMLAttributes<HTMLDivElement>
  /** Drag handle listeners (from useSortable) */
  listeners?: SyntheticListenerMap
  /** Style for transform/transition during drag */
  style?: React.CSSProperties
  /** Whether the item is being dragged (for styling) */
  isDragging?: boolean
  /** Whether this is rendered in the overlay (disables interactions) */
  isOverlay?: boolean
  /** Handler for input value changes */
  onChange?: (value: string) => void
  /** Handler for color changes */
  onColorChange?: (color: SelectOptionColor) => void
  /** Handler for removing the option */
  onRemove?: () => void
}

/**
 * Presentational component for rendering an option item
 * Used by both SortableOption and DragOverlay
 */
const OptionItem = forwardRef<HTMLDivElement, OptionItemProps>(
  (
    {
      option,
      attributes,
      listeners,
      style,
      isDragging,
      isOverlay,
      onChange,
      onColorChange,
      onRemove,
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        style={style}
        className={cn(
          'flex items-center gap-2 pe-1 ps-1',
          isDragging && !isOverlay && 'bg-accent rounded-md'
        )}>
        <InputGroup className={cn(isDragging && !isOverlay && 'opacity-20')}>
          <InputGroupAddon align='inline-start' className='pl-0!'>
            <div
              {...attributes}
              {...listeners}
              className={cn(
                'cursor-grab h-8 flex items-center ps-1.5 pe-2',
                isOverlay && 'cursor-grabbing'
              )}>
              <GripVertical className='size-3 text-muted-foreground group-hover/input-group:text-primary-600' />
            </div>
          </InputGroupAddon>
          <InputGroupAddon align='inline-start' className='pl-0!'>
            <OptionColorPicker
              value={option.color}
              onChange={(color) => onColorChange?.(color)}
              disabled={isOverlay}
            />
          </InputGroupAddon>
          <InputGroupInput
            value={option.label}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder='Option'
            className='flex-1'
            readOnly={isOverlay}
          />
          <InputGroupAddon align='inline-end'>
            <InputGroupButton
              type='button'
              variant='destructive-hover'
              className='rounded-lg me-0.5'
              aria-label='Remove item'
              title='Remove'
              size='icon-xs'
              onClick={onRemove}
              disabled={isOverlay}>
              <Trash2 />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    )
  }
)
OptionItem.displayName = 'OptionItem'

interface SortableOptionProps {
  option: Option
  onChange: (value: string) => void
  onColorChange: (color: SelectOptionColor) => void
  onRemove: () => void
}

/**
 * SortableOption component for making options draggable
 * Wraps OptionItem with useSortable hook
 */
function SortableOption({ option, onChange, onColorChange, onRemove }: SortableOptionProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: option.id,
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.8 : 1,
  }

  return (
    <OptionItem
      ref={setNodeRef}
      option={option}
      attributes={attributes}
      listeners={listeners}
      style={style}
      isDragging={isDragging}
      onChange={onChange}
      onColorChange={onColorChange}
      onRemove={onRemove}
    />
  )
}

/**
 * Get the next auto-assigned color for a new option.
 * Cycles through OPTION_COLORS in order, skipping colors already used by existing options.
 * Wraps around if all colors are used.
 */
function getNextOptionColor(existingOptions: Option[]): SelectOptionColor {
  const usedColors = new Set(existingOptions.map((opt) => opt.color).filter(Boolean))

  // Find the first unused color in the palette
  for (const color of OPTION_COLORS) {
    if (!usedColors.has(color.id)) {
      return color.id
    }
  }

  // All colors used — assign based on index (modulo wrap-around)
  return OPTION_COLORS[existingOptions.length % OPTION_COLORS.length]!.id
}

interface OptionsEditorProps {
  options?: Array<{ label: string; value: string; color?: SelectOptionColor }>
  onChange: (options: Array<{ label: string; value: string; color?: SelectOptionColor }>) => void
}

export function OptionsEditor({ options, onChange }: OptionsEditorProps) {
  // Convert options to include id for stable sorting
  const [internalOptions, setInternalOptions] = useState<Option[]>(() =>
    Array.isArray(options) ? options.map((opt) => ({ ...opt, id: crypto.randomUUID() })) : []
  )

  // Update internal options when external options change
  useEffect(() => {
    const optionsArray = Array.isArray(options) ? options : []
    if (optionsArray.length !== internalOptions.length) {
      setInternalOptions(optionsArray.map((opt) => ({ ...opt, id: crypto.randomUUID() })))
    }
  }, [options, internalOptions.length])

  // DnD state for overlay
  const [activeOption, setActiveOption] = useState<Option | null>(null)

  // Set up DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Minimum 5px movement before activating drag
      },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Function to add a new option
  const addOption = () => {
    const newOptions = [
      ...internalOptions,
      {
        label: '',
        value: '',
        color: getNextOptionColor(internalOptions),
        id: crypto.randomUUID(),
      },
    ]
    setInternalOptions(newOptions)
    onChange(newOptions.map(({ label, value, color }) => ({ label, value, color })))
  }

  // Function to update an option label (sets both label and value to same string)
  const updateOption = (index: number, newValue: string) => {
    const newOptions = [...internalOptions]
    newOptions[index]!.label = newValue
    newOptions[index]!.value = newValue
    setInternalOptions(newOptions)
    onChange(newOptions.map(({ label, value, color }) => ({ label, value, color })))
  }

  // Function to update an option color
  const updateOptionColor = (index: number, color: SelectOptionColor) => {
    const newOptions = [...internalOptions]
    newOptions[index]!.color = color
    setInternalOptions(newOptions)
    onChange(newOptions.map(({ label, value, color }) => ({ label, value, color })))
  }

  // Function to remove an option
  const removeOption = (index: number) => {
    const newOptions = internalOptions.filter((_, i) => i !== index)
    setInternalOptions(newOptions)
    onChange(newOptions.map(({ label, value, color }) => ({ label, value, color })))
  }

  // Handle DnD events
  const handleDragStart = (event: any) => {
    const option = internalOptions.find((opt) => opt.id === event.active.id) || null
    setActiveOption(option)
  }
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = internalOptions.findIndex((item) => item.id === active.id)
      const newIndex = internalOptions.findIndex((item) => item.id === over.id)
      const newItems = arrayMove(internalOptions, oldIndex, newIndex)

      setInternalOptions(newItems)
      onChange(newItems.map(({ label, value, color }) => ({ label, value, color })))
    }
    setActiveOption(null)
  }
  const handleDragCancel = () => setActiveOption(null)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      modifiers={[restrictToVerticalAxis]}>
      <div className='mb-0 rounded-xl border pt-1 pb-3 px-1 bg-primary-50 relative'>
        <div className='flex items-center justify-between pb-1'>
          <h4 className='ps-1 text-sm font-medium leading-none'>Options</h4>
          <Button type='button' variant='ghost' size='sm' onClick={addOption}>
            <PlusCircle />
            Add Option
          </Button>
        </div>

        {internalOptions.length === 0 ? (
          <p className='ps-2 h-8 flex items-center text-sm text-muted-foreground'>
            No options added yet.
          </p>
        ) : (
          <>
            <div className=' space-y-1'>
              <SortableContext
                items={internalOptions.map((option) => option.id)}
                strategy={verticalListSortingStrategy}>
                {internalOptions.map((option, index) => (
                  <SortableOption
                    key={option.id}
                    option={option}
                    onChange={(value) => updateOption(index, value)}
                    onColorChange={(color) => updateOptionColor(index, color)}
                    onRemove={() => removeOption(index)}
                  />
                ))}
              </SortableContext>
            </div>
            {/* Drag overlay for smooth dragging UX */}
            <DragOverlay adjustScale={false} modifiers={[restrictToParentElement]}>
              {activeOption ? <OptionItem option={activeOption} isOverlay /> : null}
            </DragOverlay>
          </>
        )}
      </div>
    </DndContext>
  )
}
