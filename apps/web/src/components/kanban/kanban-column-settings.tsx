// apps/web/src/components/kanban/kanban-column-settings.tsx
'use client'

import { useState, useEffect, useRef } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Switch } from '@auxx/ui/components/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@auxx/ui/components/input-group'
import { NumberInput, NumberInputField, NumberInputArrows } from '@auxx/ui/components/input-number'
import { EyeOff, Trash2 } from 'lucide-react'
import { OptionColorPicker } from '~/components/custom-fields/ui/option-color-picker'
import { DEFAULT_SELECT_OPTION_COLOR, type SelectOptionColor } from '@auxx/lib/custom-fields/client'
import type { TargetTimeInStatus } from '../dynamic-table/types'

/** Time unit options for target time in status */
type TimeUnit = 'days' | 'months' | 'years'

/** Column option data that can be changed */
export interface ColumnOptionChanges {
  label?: string
  color?: string
  targetTimeInStatus?: TargetTimeInStatus | null
  celebration?: boolean
}

/** Props for KanbanColumnSettings component */
interface KanbanColumnSettingsProps {
  /** Column ID (option value) - optional for create mode */
  columnId?: string
  /** Current label */
  label?: string
  /** Current color */
  color?: string
  /** Target time in status */
  targetTimeInStatus?: TargetTimeInStatus
  /** Celebration enabled */
  celebration?: boolean
  /** Is visible in current view */
  isVisible?: boolean

  /** Mode: 'full' shows all sections, 'create' shows only label + color */
  mode?: 'full' | 'create'

  /** Single callback for all option changes (for existing columns) */
  onChange?: (changes: ColumnOptionChanges) => void
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
 * Allows editing label, color, time tracking, celebration, and visibility.
 * In 'create' mode, shows only label + color for creating new columns.
 */
export function KanbanColumnSettings({
  columnId,
  label = '',
  color = DEFAULT_SELECT_OPTION_COLOR,
  targetTimeInStatus,
  celebration = false,
  isVisible = true,
  mode = 'full',
  onChange,
  onVisibilityChange,
  onDelete,
  onCreate,
  children,
}: KanbanColumnSettingsProps) {
  const [open, setOpen] = useState(false)
  const [localLabel, setLocalLabel] = useState(label)
  const [localColor, setLocalColor] = useState(color)
  const [trackTimeEnabled, setTrackTimeEnabled] = useState(!!targetTimeInStatus)
  const [targetTimeValue, setTargetTimeValue] = useState(targetTimeInStatus?.value ?? 5)
  const [targetTimeUnit, setTargetTimeUnit] = useState<TimeUnit>(targetTimeInStatus?.unit ?? 'days')
  const [localCelebration, setLocalCelebration] = useState(celebration)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync local state when props change (when not open)
  useEffect(() => {
    if (!open && mode === 'full') {
      setLocalLabel(label)
      setLocalColor(color)
      setTrackTimeEnabled(!!targetTimeInStatus)
      if (targetTimeInStatus) {
        setTargetTimeValue(targetTimeInStatus.value)
        setTargetTimeUnit(targetTimeInStatus.unit)
      }
      setLocalCelebration(celebration)
    }
  }, [label, color, targetTimeInStatus, celebration, mode, open])

  // Reset state when opening in create mode
  useEffect(() => {
    if (open && mode === 'create') {
      setLocalLabel('')
      setLocalColor(DEFAULT_SELECT_OPTION_COLOR)
      // Focus input after dropdown opens
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open, mode])

  /** Build changes object from local state vs props */
  const getChanges = (): ColumnOptionChanges | null => {
    const changes: ColumnOptionChanges = {}
    let hasChanges = false

    if (localLabel !== label) {
      changes.label = localLabel
      hasChanges = true
    }
    if (localColor !== color) {
      changes.color = localColor
      hasChanges = true
    }

    const currentTime = targetTimeInStatus
    const newTime = trackTimeEnabled ? { value: targetTimeValue, unit: targetTimeUnit } : null
    const timeChanged = trackTimeEnabled !== !!currentTime ||
      (trackTimeEnabled && (targetTimeValue !== currentTime?.value || targetTimeUnit !== currentTime?.unit))
    if (timeChanged) {
      changes.targetTimeInStatus = newTime
      hasChanges = true
    }

    if (localCelebration !== celebration) {
      changes.celebration = localCelebration
      hasChanges = true
    }

    return hasChanges ? changes : null
  }

  /** Handle dropdown open/close - save changes on close */
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && open && mode === 'full') {
      // Closing - save any pending changes
      const changes = getChanges()
      if (changes) {
        onChange?.(changes)
      }
    }
    setOpen(newOpen)
  }

  /** Handle create submission */
  const handleCreate = () => {
    if (mode === 'create' && localLabel.trim() && onCreate) {
      onCreate({ label: localLabel.trim(), color: localColor })
      setOpen(false)
    }
  }

  /** Handle label blur - for create mode only */
  const handleLabelBlur = () => {
    if (mode === 'create') {
      handleCreate()
    }
    // In full mode, changes are saved on dropdown close
  }

  /** Handle label key down - Enter to save/create, Escape to close */
  const handleLabelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (mode === 'create') {
        handleCreate()
      } else {
        // Close dropdown to trigger save
        setOpen(false)
      }
    }
    if (e.key === 'Escape') {
      // Reset local state and close without saving
      setLocalLabel(label)
      setLocalColor(color)
      setOpen(false)
    }
  }

  /** Handle color change - just update local state */
  const handleColorChange = (newColor: string) => {
    setLocalColor(newColor)
  }

  /** Handle track time toggle - just update local state */
  const handleTrackTimeToggle = (enabled: boolean) => {
    setTrackTimeEnabled(enabled)
  }

  /** Handle target time value change - just update local state */
  const handleTargetTimeValueChange = (value: number | undefined) => {
    if (value !== undefined && value > 0) {
      setTargetTimeValue(value)
    }
  }

  /** Handle target time unit change - just update local state */
  const handleTargetTimeUnitChange = (unit: TimeUnit) => {
    setTargetTimeUnit(unit)
  }

  /** Handle celebration toggle - just update local state */
  const handleCelebrationToggle = (enabled: boolean) => {
    setLocalCelebration(enabled)
  }

  /** Handle hide stage click - this is immediate (view-level) */
  const handleHideStage = () => {
    onVisibilityChange?.(false)
    setOpen(false)
  }

  /** Handle delete stage click - this is immediate */
  const handleDeleteStage = () => {
    onDelete?.()
    setOpen(false)
  }

  const isCreateMode = mode === 'create'

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>

      <DropdownMenuContent
        className={isCreateMode ? 'w-56' : 'min-w-[calc(var(--radix-dropdown-menu-trigger-width)+2px)] -mt-[calc(var(--radix-dropdown-menu-trigger-height)+1px)] -ml-px'}
        align="start"
        sideOffset={isCreateMode ? 4 : 0}>
        {/* Section 1: Label + Color */}
        <div className="" onPointerDown={(e) => e.stopPropagation()}>
          <InputGroup>
            <InputGroupAddon align="inline-start" className="pl-2">
              <OptionColorPicker
                value={localColor as SelectOptionColor}
                onChange={handleColorChange}
              />
            </InputGroupAddon>
            <InputGroupInput
              ref={inputRef}
              className="ps-1!"
              value={localLabel}
              onChange={(e) => setLocalLabel(e.target.value)}
              onBlur={handleLabelBlur}
              onKeyDown={handleLabelKeyDown}
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
                handleTrackTimeToggle(!trackTimeEnabled)
              }}>
              <span className="flex-1">Track time in stage</span>
              <Switch
                checked={trackTimeEnabled}
                size="sm"
                tabIndex={-1}
                className="pointer-events-none"
              />
            </DropdownMenuItem>

            {trackTimeEnabled && (
              <div className="px-2 pb-2" onPointerDown={(e) => e.stopPropagation()}>
                <NumberInput
                  value={targetTimeValue}
                  onValueChange={handleTargetTimeValueChange}
                  min={1}>
                  <div className="">
                    <InputGroup className="h-8">
                      <NumberInputField className="text-left ps-2 w-20" />
                      <Select value={targetTimeUnit} onValueChange={handleTargetTimeUnitChange}>
                        <SelectTrigger variant="transparent" size="sm" className="w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="days">Days</SelectItem>
                          <SelectItem value="months">Months</SelectItem>
                          <SelectItem value="years">Years</SelectItem>
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
                handleCelebrationToggle(!localCelebration)
              }}>
              <span className="flex-1">Celebration</span>
              <Switch
                checked={localCelebration}
                size="sm"
                tabIndex={-1}
                className="pointer-events-none"
              />
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Section 4: Actions */}
            <DropdownMenuItem onSelect={handleHideStage}>
              <EyeOff className="size-4" />
              Hide Stage
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={handleDeleteStage}>
              <Trash2 className="size-4" />
              Delete Stage
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
