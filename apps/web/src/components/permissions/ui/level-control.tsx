// apps/web/src/components/permissions/ui/level-control.tsx
'use client'

import { type AreaMetadata, Level } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { cn } from '@auxx/ui/lib/utils'
import { Undo2 } from 'lucide-react'
import { useMemo } from 'react'
import { Tooltip } from '~/components/global/tooltip'

/** Display labels for each rung, indexed by {@link Level}. */
export const LEVEL_LABELS: Record<Level, string> = {
  [Level.None]: 'None',
  [Level.Read]: 'Read',
  [Level.Edit]: 'Edit',
  [Level.Full]: 'Full',
}

interface LevelControlProps {
  /** The area this control edits — its `rungs` define the selectable levels. */
  area: AreaMetadata
  /** Explicitly-set level, or `undefined` when the area inherits (falls through). */
  value: Level | undefined
  /** The level this area falls through to when unset (role default or member baseline). */
  inherited: Level
  /**
   * Raise-only floor (override mode): levels at or below this are disabled, so an
   * override can only *raise* above the baseline. Omit for the baseline surface,
   * where any level (including a deliberate `None`) is selectable.
   */
  floor?: Level
  /** Emits the new explicit level, or `undefined` to reset the area to inherited. */
  onChange: (level: Level | undefined) => void
  disabled?: boolean
}

/**
 * A compact radio-tab level picker for one capability area. Renders one segment
 * per rung the area offers (`None` + each ladder rung — so `records` shows
 * None/Read/Edit/Full while a toggle area shows None/Full). Shows the effective
 * level (`value ?? inherited`); while inherited it renders muted, and a reset
 * button appears once an explicit level is set. In override mode, rungs at or
 * below `floor` are disabled (raise-only).
 */
export function LevelControl({
  area,
  value,
  inherited,
  floor,
  onChange,
  disabled = false,
}: LevelControlProps) {
  const levels = useMemo<Level[]>(
    () => [Level.None, ...area.rungs.map((r) => r.level)],
    [area.rungs]
  )
  const effective = value ?? inherited
  const isExplicit = value !== undefined

  return (
    <div className='flex items-center gap-1'>
      <RadioTab
        value={String(effective)}
        onValueChange={(v) => onChange(Number(v) as Level)}
        size='sm'
        className={cn(!isExplicit && 'opacity-60')}>
        {levels.map((level) => (
          <RadioTabItem
            key={level}
            value={String(level)}
            size='sm'
            disabled={disabled || (floor !== undefined && level <= floor)}
            className='min-w-0 px-2.5'>
            {LEVEL_LABELS[level]}
          </RadioTabItem>
        ))}
      </RadioTab>
      <Tooltip content='Reset to inherited'>
        <Button
          type='button'
          size='icon-sm'
          variant='ghost'
          aria-label='Reset to inherited'
          disabled={disabled || !isExplicit}
          className={cn('text-muted-foreground', !isExplicit && 'invisible')}
          onClick={() => onChange(undefined)}>
          <Undo2 />
        </Button>
      </Tooltip>
    </div>
  )
}
