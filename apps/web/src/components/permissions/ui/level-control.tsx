// apps/web/src/components/permissions/ui/level-control.tsx
'use client'

import { type AreaMetadata, Level } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Undo2 } from 'lucide-react'
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
   * Override mode: the explicit level lifts nothing above the baseline, so the
   * server composes it away. Renders an "ignored" warning next to the selector.
   */
  ignored?: boolean
  /** Emits the new explicit level, or `undefined` to reset the area to inherited. */
  onChange: (level: Level | undefined) => void
  disabled?: boolean
}

/**
 * A compact radio-tab level picker for one capability area. Renders one segment
 * per rung the area offers (`None` + each ladder rung — so `records` shows
 * None/Read/Edit/Full while a toggle area shows None/Full). Shows the effective
 * level (`value ?? inherited`); while inherited it renders muted, and a reset
 * button appears once an explicit level is set. Every rung stays selectable —
 * the raise-only rule for overrides is enforced server-side (an override at or
 * below the baseline is composed away), and surfaced in the UI as an "ignored"
 * warning rather than a disabled rung.
 */
export function LevelControl({
  area,
  value,
  inherited,
  ignored = false,
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
      <Tooltip content='This override is ignored — the member baseline already grants this level of access.'>
        <AlertTriangle
          className={cn('size-3.5 text-amber-500', !ignored && 'invisible')}
          aria-hidden={!ignored}
        />
      </Tooltip>
      <Tooltip content='Reset to inherited'>
        <Button
          type='button'
          size='icon-sm'
          variant='ghost'
          aria-label='Reset to inherited'
          disabled={disabled || !isExplicit}
          className={cn('size-6 text-muted-foreground', !isExplicit && 'invisible')}
          onClick={() => onChange(undefined)}>
          <Undo2 />
        </Button>
      </Tooltip>
      <RadioTab
        value={String(effective)}
        onValueChange={(v) => onChange(Number(v) as Level)}
        size='xs'
        radioGroupClassName='after:rounded-lg'
        className={cn('rounded-lg', !isExplicit && '')}>
        {levels.map((level) => (
          <RadioTabItem
            key={level}
            value={String(level)}
            size='xs'
            disabled={disabled}
            className='h-full w-auto min-w-0 rounded-lg px-2.5'>
            {LEVEL_LABELS[level]}
          </RadioTabItem>
        ))}
      </RadioTab>
    </div>
  )
}
