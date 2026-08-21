// apps/web/src/components/custom-fields/ui/options-editor.tsx
'use client'

import type { FieldOptions } from '@auxx/lib/field-values/client'
import type { SelectOptionColor } from '@auxx/types/custom-field'
import type { ResourceFieldId } from '@auxx/types/field'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { generateId } from '@auxx/utils/generateId'
import { GripVertical, PlusCircle, Trash2 } from 'lucide-react'
import { forwardRef, useEffect, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { getNextOptionColor } from '../utils/get-next-option-color'
import { OptionColorPicker } from './option-color-picker'

/** Select option type for editor state. */
export type SelectOption = {
  label: string
  value: string
  color?: SelectOptionColor
  /**
   * Present only on app/connector-provisioned option sets. It is the key their
   * `FieldValue` rows carry, so it MUST round-trip through this editor untouched —
   * dropping it makes the update cascade read the option as deleted and destroy
   * every value stored under it.
   */
  id?: string
}

/**
 * Parse stored field options into editor state.
 * Handles both formats: options.options (nested) and options as array (flat).
 *
 * Options authored in this editor are value-keyed — `value` is the key their FieldValue
 * rows carry. An explicit `id` (app/connector-provisioned option sets) is preserved
 * verbatim: it is the stored key for those options, and `updateCustomField`'s cascade
 * diffs on it. Dropping it here would present the option as deleted and cascade away
 * every value under it. Connector fields are marked by `dataConnectorId`, not
 * `appInstallationId`, so `isProtectedField` does NOT keep them out of this editor.
 */
export function parseSelectOptions(fieldOptions?: FieldOptions): SelectOption[] {
  // Handle nested format (options.options)
  if (fieldOptions?.options && Array.isArray(fieldOptions.options)) {
    return fieldOptions.options.map((opt) => ({
      label: opt.label,
      value: opt.value,
      color: opt.color as SelectOptionColor | undefined,
      ...(opt.id ? { id: opt.id } : {}),
    }))
  }
  // Handle flat format (options is array) - legacy support
  if (Array.isArray(fieldOptions)) {
    return fieldOptions.map((opt) => ({
      label: opt.label,
      value: opt.value,
      color: opt.color as SelectOptionColor | undefined,
      ...(opt.id ? { id: opt.id } : {}),
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
  type DraggableSyntheticListeners,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
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

/**
 * An option as edited here. `value` is the option's identity: minted once at create time
 * and never rewritten, so it doubles as the dnd sort key. Only `label` and `color` are
 * editable — a rename that moved `value` would orphan every stored value of the option.
 */
type Option = SelectOption

interface OptionItemProps {
  option: Option
  /** Drag handle attributes (from useSortable) */
  attributes?: React.HTMLAttributes<HTMLDivElement>
  /** Drag handle listeners (from useSortable) */
  listeners?: DraggableSyntheticListeners
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
  /** Records currently carrying this option. Undefined = not counted (yet, or no field). */
  usageCount?: number
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
      usageCount,
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
            {usageCount !== undefined && (
              <span
                className='text-[10px] text-muted-foreground tabular-nums'
                title={`Used on ${recordsPhrase(usageCount)}`}>
                {usageCount}
              </span>
            )}
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
  usageCount?: number
}

/**
 * SortableOption component for making options draggable
 * Wraps OptionItem with useSortable hook
 */
function SortableOption({
  option,
  onChange,
  onColorChange,
  onRemove,
  usageCount,
}: SortableOptionProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: option.value,
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
      usageCount={usageCount}
    />
  )
}

interface OptionsEditorProps {
  options?: Option[]
  onChange: (options: Option[]) => void
  /**
   * The field being edited, when it already exists. Enables the usage count: removing
   * an option here cascades to every record that stores it once the field is saved,
   * so the confirm needs a real number.
   *
   * Optional — a field being created has no id yet, and this editor also backs form
   * input nodes and the schema editor, which have no field behind them at all. Those
   * keep the plain immediate remove with no dialog.
   */
  resourceFieldId?: ResourceFieldId
}

/** "1 record" / "47 records" — used in the remove confirm and the inline hint. */
function recordsPhrase(count: number): string {
  return `${count} ${count === 1 ? 'record' : 'records'}`
}

/**
 * Editor for a select/tag field's option list: add, rename, recolor, reorder, remove.
 *
 * Fully controlled — `options` is rendered directly and every change is pushed up through
 * `onChange`. There is no local mirror: `value` is a stable minted key, so it serves as
 * the dnd sort id and external label/color edits show up immediately.
 */
export function OptionsEditor({ options, onChange, resourceFieldId }: OptionsEditorProps) {
  const items: Option[] = Array.isArray(options) ? options : []

  const [confirm, ConfirmDialog] = useConfirm()

  // One query for the whole field when the editor opens — the endpoint returns a count
  // for every option, so removing one never costs its own round trip.
  const usageQuery = api.customField.countOptionUsage.useQuery(
    { resourceFieldId: resourceFieldId ?? ('' as ResourceFieldId) },
    { enabled: Boolean(resourceFieldId) }
  )
  const usageCounts = usageQuery.data
  const usageError = usageQuery.error

  useEffect(() => {
    // A member without def-administration rights gets a 403 from this query. They can't
    // delete an option either (`customField.update` is gated the same way), so the denial
    // is expected here and not worth a toast.
    const code = usageError?.data?.code
    if (usageError && code !== 'FORBIDDEN' && code !== 'UNAUTHORIZED') {
      toastError({ title: 'Error loading option usage', description: usageError.message })
    }
  }, [usageError])

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

  // Mint the option's key once, here. It never changes again — see updateOption.
  const addOption = () => {
    onChange([
      ...items,
      {
        label: '',
        value: generateId(),
        color: getNextOptionColor(items.map((o) => o.color).filter(Boolean) as SelectOptionColor[]),
      },
    ])
  }

  // Writes ONLY the label. `value` is the key stored on every FieldValue of this option;
  // rewriting it on a rename would orphan them all (and, once the delete cascade lands,
  // would look like a delete). See plans/custom-fields/orphaned-option-values.md (D4).
  const updateOption = (index: number, label: string) => {
    onChange(items.map((opt, i) => (i === index ? { ...opt, label } : opt)))
  }

  const updateOptionColor = (index: number, color: SelectOptionColor) => {
    onChange(items.map((opt, i) => (i === index ? { ...opt, color } : opt)))
  }

  // The stored key is `id ?? value` — the same rule `optionKey` applies server-side, so
  // the count endpoint reports under it too. An option added in this session isn't in
  // the counts at all, which correctly reads as zero.
  const removeOption = async (index: number) => {
    const option = items[index]
    if (!option) return

    if (resourceFieldId) {
      const used = usageCounts ? (usageCounts[option.id ?? option.value] ?? 0) : undefined
      // `undefined` means the counts never arrived (still loading, or the query
      // failed). Warn anyway — it just can't name a number.
      if (used === undefined || used > 0) {
        const confirmed = await confirm({
          title: `Delete "${option.label || 'this option'}"?`,
          description:
            used === undefined
              ? "It will be removed from every record that uses it when you save this field. This can't be undone."
              : `It's used on ${recordsPhrase(used)} and will be removed from all of them when you save this field. This can't be undone.`,
          confirmText: 'Remove',
          destructive: true,
        })
        if (!confirmed) return
      }
    }

    onChange(items.filter((_, i) => i !== index))
  }

  // Handle DnD events
  const handleDragStart = (event: DragStartEvent) => {
    setActiveOption(items.find((opt) => opt.value === event.active.id) ?? null)
  }
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.value === active.id)
      const newIndex = items.findIndex((item) => item.value === over.id)
      onChange(arrayMove(items, oldIndex, newIndex))
    }
    setActiveOption(null)
  }
  const handleDragCancel = () => setActiveOption(null)

  return (
    <>
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

          {items.length === 0 ? (
            <p className='ps-2 h-8 flex items-center text-sm text-muted-foreground'>
              No options added yet.
            </p>
          ) : (
            <>
              <div className=' space-y-1'>
                <SortableContext
                  items={items.map((option) => option.value)}
                  strategy={verticalListSortingStrategy}>
                  {items.map((option, index) => (
                    <SortableOption
                      key={option.value}
                      option={option}
                      onChange={(value) => updateOption(index, value)}
                      onColorChange={(color) => updateOptionColor(index, color)}
                      onRemove={() => void removeOption(index)}
                      usageCount={usageCounts?.[option.id ?? option.value]}
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
      {/* Sibling of DndContext, not a child: React portal events bubble to the React
          parent, so a confirm inside the dnd tree hands its Space/Enter to the
          keyboard sensor. */}
      <ConfirmDialog />
    </>
  )
}
