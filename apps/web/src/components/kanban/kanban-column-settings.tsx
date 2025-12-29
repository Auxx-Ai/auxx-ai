// apps/web/src/components/kanban/kanban-column-settings.tsx
'use client'

import { useState, useEffect } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
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
import { Separator } from '@auxx/ui/components/separator'
import { EyeOff, Trash2 } from 'lucide-react'
import { OptionColorPicker } from '~/components/custom-fields/ui/option-color-picker'
import type { SelectOptionColor } from '@auxx/lib/custom-fields/client'
import type { TargetTimeInStatus } from '../dynamic-table/types'

/** Time unit options for target time in status */
type TimeUnit = 'days' | 'months' | 'years'

/** Props for KanbanColumnSettings component */
interface KanbanColumnSettingsProps {
  /** Column ID (option value) */
  columnId: string
  /** Current label */
  label: string
  /** Current color */
  color?: string
  /** Target time in status */
  targetTimeInStatus?: TargetTimeInStatus
  /** Celebration enabled */
  celebration?: boolean
  /** Is visible in current view */
  isVisible?: boolean
  /** Whether this is the "No Status" column (can't be deleted/hidden) */
  isNoStatusColumn?: boolean

  /** Callbacks */
  onLabelChange?: (label: string) => void
  onColorChange?: (color: string) => void
  onTargetTimeChange?: (time: TargetTimeInStatus | null) => void
  onCelebrationChange?: (enabled: boolean) => void
  onVisibilityChange?: (visible: boolean) => void
  onDelete?: () => void

  /** Children = trigger element */
  children: React.ReactNode
}

/**
 * Popover component for kanban column settings.
 * Allows editing label, color, time tracking, celebration, and visibility.
 */
export function KanbanColumnSettings({
  columnId,
  label,
  color = 'gray',
  targetTimeInStatus,
  celebration = false,
  isVisible = true,
  isNoStatusColumn = false,
  onLabelChange,
  onColorChange,
  onTargetTimeChange,
  onCelebrationChange,
  onVisibilityChange,
  onDelete,
  children,
}: KanbanColumnSettingsProps) {
  const [open, setOpen] = useState(false)
  const [localLabel, setLocalLabel] = useState(label)
  const [trackTimeEnabled, setTrackTimeEnabled] = useState(!!targetTimeInStatus)
  const [targetTimeValue, setTargetTimeValue] = useState(targetTimeInStatus?.value ?? 5)
  const [targetTimeUnit, setTargetTimeUnit] = useState<TimeUnit>(targetTimeInStatus?.unit ?? 'days')
  const [localCelebration, setLocalCelebration] = useState(celebration)

  // Sync local state when props change
  useEffect(() => {
    setLocalLabel(label)
  }, [label])

  useEffect(() => {
    setTrackTimeEnabled(!!targetTimeInStatus)
    if (targetTimeInStatus) {
      setTargetTimeValue(targetTimeInStatus.value)
      setTargetTimeUnit(targetTimeInStatus.unit)
    }
  }, [targetTimeInStatus])

  useEffect(() => {
    setLocalCelebration(celebration)
  }, [celebration])

  /** Handle label blur - save when focus leaves */
  const handleLabelBlur = () => {
    if (localLabel !== label && localLabel.trim()) {
      onLabelChange?.(localLabel.trim())
    }
  }

  /** Handle label key down - save on Enter */
  const handleLabelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (localLabel !== label && localLabel.trim()) {
        onLabelChange?.(localLabel.trim())
      }
    }
  }

  /** Handle track time toggle */
  const handleTrackTimeToggle = (enabled: boolean) => {
    setTrackTimeEnabled(enabled)
    if (enabled) {
      onTargetTimeChange?.({ value: targetTimeValue, unit: targetTimeUnit })
    } else {
      onTargetTimeChange?.(null)
    }
  }

  /** Handle target time value change */
  const handleTargetTimeValueChange = (value: number | undefined) => {
    if (value !== undefined && value > 0) {
      setTargetTimeValue(value)
      if (trackTimeEnabled) {
        onTargetTimeChange?.({ value, unit: targetTimeUnit })
      }
    }
  }

  /** Handle target time unit change */
  const handleTargetTimeUnitChange = (unit: TimeUnit) => {
    setTargetTimeUnit(unit)
    if (trackTimeEnabled) {
      onTargetTimeChange?.({ value: targetTimeValue, unit })
    }
  }

  /** Handle celebration toggle */
  const handleCelebrationToggle = (enabled: boolean) => {
    setLocalCelebration(enabled)
    onCelebrationChange?.(enabled)
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>

      <PopoverContent className="w-72 p-0" align="start">
        {/* Section 1: Label + Color */}
        <div className="p-3 pb-2">
          <InputGroup>
            <InputGroupAddon align="inline-start" className="pl-3">
              <OptionColorPicker
                value={color as SelectOptionColor}
                onChange={(newColor) => onColorChange?.(newColor)}
                disabled={isNoStatusColumn}
              />
            </InputGroupAddon>
            <InputGroupInput
              value={localLabel}
              onChange={(e) => setLocalLabel(e.target.value)}
              onBlur={handleLabelBlur}
              onKeyDown={handleLabelKeyDown}
              placeholder="Stage name"
              disabled={isNoStatusColumn}
            />
          </InputGroup>
        </div>

        <Separator />

        {/* Section 2: Track time in stage */}
        <div className="">
          <button
            type="button"
            className="p-3 w-full flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isNoStatusColumn}
            onClick={() => !isNoStatusColumn && handleTrackTimeToggle(!trackTimeEnabled)}>
            <span className="text-sm">Track time in stage</span>
            <Switch
              checked={trackTimeEnabled}
              size="sm"
              tabIndex={-1}
              className="pointer-events-none"
            />
          </button>

          {trackTimeEnabled && (
            <div className="px-3 pb-3 flex gap-2">
              <NumberInput
                value={targetTimeValue}
                onValueChange={handleTargetTimeValueChange}
                min={1}>
                <InputGroup className="h-8">
                  <NumberInputField className="text-left ps-2" />
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
              </NumberInput>
            </div>
          )}
        </div>

        <Separator />

        {/* Section 3: Celebration */}
        <button
          type="button"
          className="p-3 w-full flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={isNoStatusColumn}
          onClick={() => !isNoStatusColumn && handleCelebrationToggle(!localCelebration)}>
          <span className="text-sm">Celebration</span>
          <Switch
            checked={localCelebration}
            size="sm"
            tabIndex={-1}
            className="pointer-events-none"
          />
        </button>

        <Separator />

        {/* Section 4: Actions */}
        <div className="p-1">
          {!isNoStatusColumn && (
            <>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted"
                onClick={handleHideStage}>
                <EyeOff className="size-4" />
                Hide Stage
              </button>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-destructive/10 text-destructive"
                onClick={handleDeleteStage}>
                <Trash2 className="size-4" />
                Delete Stage
              </button>
            </>
          )}
          {isNoStatusColumn && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              The "No Stage" column cannot be modified.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
