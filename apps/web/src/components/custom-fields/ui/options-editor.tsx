// ~/components/custom-fields/ui/options-editor.tsx
import { useState, useEffect, forwardRef } from 'react'
import { Button } from '@auxx/ui/components/button'
import { PlusCircle, GripVertical, Trash2 } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type SyntheticListenerMap,
  DragOverlay,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@auxx/ui/lib/utils'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'

interface Option {
  label: string
  value: string
  id: string // Adding id for stable sorting
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
  /** Handler for removing the option */
  onRemove?: () => void
}

/**
 * Presentational component for rendering an option item
 * Used by both SortableOption and DragOverlay
 */
const OptionItem = forwardRef<HTMLDivElement, OptionItemProps>(
  ({ option, attributes, listeners, style, isDragging, isOverlay, onChange, onRemove }, ref) => {
    return (
      <div
        ref={ref}
        style={style}
        className={cn(
          'flex items-center gap-2 pe-1 ps-1',
          isDragging && !isOverlay && 'bg-accent rounded-md'
        )}>
        <InputGroup className={cn(isDragging && !isOverlay && 'opacity-20')}>
          <InputGroupAddon align="inline-start">
            <div
              {...attributes}
              {...listeners}
              className={cn('cursor-grab', isOverlay && 'cursor-grabbing')}>
              <GripVertical className="size-3 text-muted-foreground group-hover/input-group:text-primary-600" />
            </div>
          </InputGroupAddon>
          <InputGroupInput
            value={option.label}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder="Option"
            className="flex-1"
            readOnly={isOverlay}
          />
          <InputGroupAddon align="inline-end" className="pe-2.5">
            <InputGroupButton
              type="button"
              variant="destructive-hover"
              className="rounded-lg"
              aria-label="Remove item"
              title="Remove"
              size="icon-xs"
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
  onRemove: () => void
}

/**
 * SortableOption component for making options draggable
 * Wraps OptionItem with useSortable hook
 */
function SortableOption({ option, onChange, onRemove }: SortableOptionProps) {
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
      onRemove={onRemove}
    />
  )
}

interface OptionsEditorProps {
  options?: Array<{ label: string; value: string }> // Make optional to handle undefined cases
  onChange: (options: Array<{ label: string; value: string }>) => void
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
    const newOptions = [...internalOptions, { label: '', value: '', id: crypto.randomUUID() }]
    setInternalOptions(newOptions)
    onChange(newOptions.map(({ label, value }) => ({ label, value })))
  }

  // Function to update an option (sets both label and value to same string)
  const updateOption = (index: number, newValue: string) => {
    const newOptions = [...internalOptions]
    newOptions[index]!.label = newValue
    newOptions[index]!.value = newValue
    setInternalOptions(newOptions)
    onChange(newOptions.map(({ label, value }) => ({ label, value })))
  }

  // Function to remove an option
  const removeOption = (index: number) => {
    const newOptions = internalOptions.filter((_, i) => i !== index)
    setInternalOptions(newOptions)
    onChange(newOptions.map(({ label, value }) => ({ label, value })))
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
      onChange(newItems.map(({ label, value }) => ({ label, value })))
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
      <div className="mb-0 rounded-xl border pt-1 pb-3 px-1 bg-primary-50 relative">
        <div className="flex items-center justify-between pb-1">
          <h4 className="ps-1 text-sm font-medium leading-none">Options</h4>
          <Button type="button" variant="ghost" size="sm" onClick={addOption}>
            <PlusCircle />
            Add Option
          </Button>
        </div>

        {internalOptions.length === 0 ? (
          <p className="ps-2 h-8 flex items-center text-sm text-muted-foreground">
            No options added yet.
          </p>
        ) : (
          <>
            <div className=" space-y-1">
              <SortableContext
                items={internalOptions.map((option) => option.id)}
                strategy={verticalListSortingStrategy}>
                {internalOptions.map((option, index) => (
                  <SortableOption
                    key={option.id}
                    option={option}
                    onChange={(value) => updateOption(index, value)}
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
