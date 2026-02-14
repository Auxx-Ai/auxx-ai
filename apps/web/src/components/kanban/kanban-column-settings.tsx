// apps/web/src/components/kanban/kanban-column-settings.tsx
'use client'

import { DEFAULT_SELECT_OPTION_COLOR, type SelectOptionColor } from '@auxx/lib/custom-fields/client'
import type { ResourceFieldId } from '@auxx/types/field'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'
import { NumberInput, NumberInputArrows, NumberInputField } from '@auxx/ui/components/input-number'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { EyeOff, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  type SelectOptionChanges,
  useFieldSelectOptionMutations,
} from '~/components/custom-fields/hooks/use-custom-field-mutations'
import { OptionColorPicker } from '~/components/custom-fields/ui/option-color-picker'
import { useFieldSelectOption } from '~/components/resources/hooks'

/** Time unit options for target time in status */
type TimeUnit = 'days' | 'months' | 'years'

/** Props for KanbanColumnSettings component */
interface KanbanColumnSettingsProps {
  /** Column ID (option value) - optional for create mode */
  columnId?: string
  /** ResourceFieldId of the groupBy field - required for mutations */
  resourceFieldId?: ResourceFieldId

  /** Mode: 'full' shows all sections, 'create' shows only label + color */
  mode?: 'full' | 'create'

  /** Visibility is view-level, separate callback */
  onVisibilityChange?: (visible: boolean) => void
  /** Delete callback */
  onDelete?: () => void
  /** Called when create mode submits (Enter or blur with valid label) */
  onCreate?: (option: { label: string; color: string }) => void

  /** Children = trigger element */
  children: React.ReactNode
}

/**
 * Dropdown menu component for kanban column settings.
 * Subscribes directly to option data via useFieldSelectOption for reactive updates.
 * Allows editing label, color, time tracking, celebration, and visibility.
 * In 'create' mode, shows only label + color for creating new columns.
 */
export function KanbanColumnSettings({
  columnId,
  resourceFieldId,
  mode = 'full',
  onVisibilityChange,
  onDelete,
  onCreate,
  children,
}: KanbanColumnSettingsProps) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Subscribe to column option data directly from store (reactive!)
  const option = useFieldSelectOption(resourceFieldId, columnId)

  // Get mutations for option changes
  const { updateOption } = useFieldSelectOptionMutations(resourceFieldId)

  // Create mode state (separate from full mode)
  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_SELECT_OPTION_COLOR)

  // Full mode: single local state for all changes, saved on close
  const [localChanges, setLocalChanges] = useState<SelectOptionChanges>({})

  // Merge defaults, option, and localChanges into display values
  const display = {
    label: '',
    color: DEFAULT_SELECT_OPTION_COLOR,
    celebration: false,
    targetTimeInStatus: null as { value: number; unit: TimeUnit } | null,
    ...option,
    ...localChanges,
  }

  // Derived for convenience (check for both null and undefined since DB may omit the key)
  const trackTimeEnabled = display.targetTimeInStatus != null
  const timeValue = display.targetTimeInStatus?.value ?? 5
  const timeUnit = display.targetTimeInStatus?.unit ?? 'days'

  // Reset create form when opening in create mode
  useEffect(() => {
    if (open && mode === 'create') {
      setNewLabel('')
      setNewColor(DEFAULT_SELECT_OPTION_COLOR)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open, mode])

  /** Helper for updating targetTimeInStatus in localChanges */
  const updateTargetTime = (updates: { value?: number; unit?: TimeUnit; enabled?: boolean }) => {
    // Disable time tracking
    if (updates.enabled === false) {
      setLocalChanges((prev) => ({ ...prev, targetTimeInStatus: null }))
      return
    }
    // Enable time tracking (only when explicitly enabling)
    if (updates.enabled === true) {
      setLocalChanges((prev) => ({
        ...prev,
        targetTimeInStatus: {
          value: prev.targetTimeInStatus?.value ?? option?.targetTimeInStatus?.value ?? 5,
          unit: prev.targetTimeInStatus?.unit ?? option?.targetTimeInStatus?.unit ?? 'days',
        },
      }))
      return
    }
    // Update value or unit (only called when already enabled)
    setLocalChanges((prev) => ({
      ...prev,
      targetTimeInStatus: {
        value:
          updates.value ?? prev.targetTimeInStatus?.value ?? option?.targetTimeInStatus?.value ?? 5,
        unit:
          updates.unit ??
          prev.targetTimeInStatus?.unit ??
          option?.targetTimeInStatus?.unit ??
          'days',
      },
    }))
  }

  /** Handle open/close - save changes on close in full mode */
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && mode === 'full' && columnId && Object.keys(localChanges).length > 0) {
      const changes = localChanges.label
        ? { ...localChanges, label: localChanges.label.trim() }
        : localChanges
      updateOption(columnId, changes)
    }
    if (!newOpen) setLocalChanges({})
    setOpen(newOpen)
  }

  /** Handle key down - Escape cancels, Enter closes (saves) */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setLocalChanges({})
      setOpen(false)
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (mode === 'create') {
        handleCreate()
      } else {
        setOpen(false)
      }
    }
  }

  /** Handle create submission */
  const handleCreate = () => {
    if (mode === 'create' && newLabel.trim() && onCreate) {
      onCreate({ label: newLabel.trim(), color: newColor })
      setOpen(false)
    }
  }

  /** Handle hide stage click */
  const handleHideStage = () => {
    onVisibilityChange?.(false)
    setOpen(false)
  }

  /** Handle delete stage click */
  const handleDeleteStage = () => {
    onDelete?.()
    setOpen(false)
  }

  const isCreateMode = mode === 'create'

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>

      <DropdownMenuContent
        className={
          isCreateMode
            ? 'w-56'
            : 'min-w-[calc(var(--radix-dropdown-menu-trigger-width)+2px)] -mt-[calc(var(--radix-dropdown-menu-trigger-height)+1px)] -ml-px'
        }
        align='start'
        sideOffset={isCreateMode ? 4 : 0}
        onKeyDown={handleKeyDown}>
        {/* Section 1: Label + Color */}
        <div className='' onPointerDown={(e) => e.stopPropagation()}>
          <InputGroup>
            <InputGroupAddon align='inline-start' className='pl-2'>
              <OptionColorPicker
                value={(isCreateMode ? newColor : display.color) as SelectOptionColor}
                onChange={(color) =>
                  isCreateMode
                    ? setNewColor(color)
                    : setLocalChanges((prev) => ({ ...prev, color }))
                }
              />
            </InputGroupAddon>
            <InputGroupInput
              ref={inputRef}
              className='ps-1!'
              value={isCreateMode ? newLabel : display.label}
              onChange={(e) =>
                isCreateMode
                  ? setNewLabel(e.target.value)
                  : setLocalChanges((prev) => ({ ...prev, label: e.target.value }))
              }
              placeholder={isCreateMode ? 'New stage name' : 'Stage name'}
            />
          </InputGroup>
        </div>

        {/* Only show remaining sections in full mode */}
        {!isCreateMode && (
          <>
            <DropdownMenuSeparator />

            {/* Section 2: Track time in stage */}
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                updateTargetTime({ enabled: !trackTimeEnabled })
              }}>
              <span className='flex-1'>Track time in stage</span>
              <Switch
                checked={trackTimeEnabled}
                size='sm'
                tabIndex={-1}
                className='pointer-events-none'
              />
            </DropdownMenuItem>

            {trackTimeEnabled && (
              <div className='py-2 px-1' onPointerDown={(e) => e.stopPropagation()}>
                <NumberInput
                  value={timeValue}
                  onValueChange={(value) => value && value > 0 && updateTargetTime({ value })}
                  min={1}>
                  <div className=''>
                    <InputGroup className='h-8'>
                      <NumberInputField className='text-left ps-2 w-20' />
                      <Select
                        value={timeUnit}
                        onValueChange={(unit: TimeUnit) => updateTargetTime({ unit })}>
                        <SelectTrigger variant='transparent' size='sm' className='w-20'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='days'>Days</SelectItem>
                          <SelectItem value='months'>Months</SelectItem>
                          <SelectItem value='years'>Years</SelectItem>
                        </SelectContent>
                      </Select>
                      <NumberInputArrows />
                    </InputGroup>
                  </div>
                </NumberInput>
              </div>
            )}

            <DropdownMenuSeparator />

            {/* Section 3: Celebration */}
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setLocalChanges((prev) => ({ ...prev, celebration: !display.celebration }))
              }}>
              <span className='flex-1'>Celebration</span>
              <Switch
                checked={display.celebration}
                size='sm'
                tabIndex={-1}
                className='pointer-events-none'
              />
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Section 4: Actions */}
            <DropdownMenuItem onSelect={handleHideStage}>
              <EyeOff className='size-4' />
              Hide Stage
            </DropdownMenuItem>
            <DropdownMenuItem variant='destructive' onSelect={handleDeleteStage}>
              <Trash2 className='size-4' />
              Delete Stage
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
