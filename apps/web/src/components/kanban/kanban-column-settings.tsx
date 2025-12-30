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

  // Sync local state when props change (only when closed to avoid fighting with user input)
  useEffect(() => {
    if (!open) {
      setLocalLabel(label)
      setLocalColor(color)
      setTrackTimeEnabled(!!targetTimeInStatus)
      if (targetTimeInStatus) {
        setTargetTimeValue(targetTimeInStatus.value)
        setTargetTimeUnit(targetTimeInStatus.unit)
      } else {
        setTargetTimeValue(5)
        setTargetTimeUnit('days')
      }
      setLocalCelebration(celebration)
    }
  }, [label, color, targetTimeInStatus, celebration, open])

  // Focus input when opening in create mode
  useEffect(() => {
    if (open && mode === 'create') {
      setLocalLabel('')
      setLocalColor(DEFAULT_SELECT_OPTION_COLOR)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open, mode])

  /** Handle create submission */
  const handleCreate = () => {
    if (mode === 'create' && localLabel.trim() && onCreate) {
      onCreate({ label: localLabel.trim(), color: localColor })
      setOpen(false)
    }
  }

  /** Commit label change - called on blur or Enter */
  const handleLabelCommit = () => {
    if (mode === 'create') {
      handleCreate()
      return
    }
    // In full mode, save if changed
    if (localLabel.trim() && localLabel !== label) {
      onChange?.({ label: localLabel.trim() })
    }
  }

  /** Handle label key down */
  const handleLabelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleLabelCommit()
      if (mode === 'full') {
        setOpen(false)
      }
    }
    if (e.key === 'Escape') {
      setLocalLabel(label) // Reset
      setOpen(false)
    }
  }

  /** Handle color change - immediate save */
  const handleColorChange = (newColor: string) => {
    setLocalColor(newColor)
    if (mode === 'full') {
      onChange?.({ color: newColor })
    }
  }

  /** Handle track time toggle - immediate save */
  const handleTrackTimeToggle = (enabled: boolean) => {
    setTrackTimeEnabled(enabled)
    if (mode === 'full') {
      if (enabled) {
        onChange?.({ targetTimeInStatus: { value: targetTimeValue, unit: targetTimeUnit } })
      } else {
        onChange?.({ targetTimeInStatus: null })
      }
    }
  }

  /** Handle target time value change - immediate save */
  const handleTargetTimeValueChange = (value: number | undefined) => {
    if (value !== undefined && value > 0) {
      setTargetTimeValue(value)
      if (mode === 'full' && trackTimeEnabled) {
        onChange?.({ targetTimeInStatus: { value, unit: targetTimeUnit } })
      }
    }
  }

  /** Handle target time unit change - immediate save */
  const handleTargetTimeUnitChange = (unit: TimeUnit) => {
    setTargetTimeUnit(unit)
    if (mode === 'full' && trackTimeEnabled) {
      onChange?.({ targetTimeInStatus: { value: targetTimeValue, unit } })
    }
  }

  /** Handle celebration toggle - immediate save */
  const handleCelebrationToggle = (enabled: boolean) => {
    setLocalCelebration(enabled)
    if (mode === 'full') {
      onChange?.({ celebration: enabled })
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
    <DropdownMenu open={open} onOpenChange={setOpen}>
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
              onBlur={handleLabelCommit}
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
