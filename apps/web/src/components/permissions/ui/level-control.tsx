// apps/web/src/components/permissions/ui/level-control.tsx
'use client'

import { type AreaMetadata, Level } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Undo2 } from 'lucide-react'
import { useMemo } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { RUNG_LABELS } from './level-labels'

/**
 * The highest rung `area` actually offers at or below `level` — what a level
 * from outside this area's ladder composes down to.
 *
 * Exported because callers need the same answer the control displays: an agent
 * policy's collection default is one rung for every area at once, so a row must
 * be able to name what that default resolves to *here* rather than repeating a
 * rung the area cannot express.
 */
export function clampToArea(area: AreaMetadata, level: Level): Level {
  const levels = [Level.None, ...area.rungs.map((r) => r.level)]
  return levels.filter((l) => l <= level).at(-1) ?? Level.None
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
  /**
   * Muted text rendered beside the control while nothing explicit is stored —
   * how a caller names the fall-through. Agent grantees pass `'Default'` so an
   * unset area reads "Default · Full" (set-semantics: absent ⇒ Full) instead of
   * silently looking identical to an explicit Full. Omitted for the member
   * surfaces, where the reset button alone marks the explicit state.
   */
  unsetHint?: string
  /** Tooltip on the reset button. Defaults to the inherit wording. */
  resetTooltip?: string
}

/**
 * A compact radio-tab level picker for one capability area. Renders one segment
 * per rung the area offers (`None` + each ladder rung — so `records` shows
 * None/Read/Edit/Full while a toggle area shows None/Full). Shows the effective
 * level (`value ?? inherited`, clamped down to the nearest rung the area
 * actually offers); while inherited it renders muted, and a reset
 * button appears once an explicit level is set. Every rung stays selectable —
 * the raise-only rule for overrides is enforced server-side (an override at or
 * below the baseline is composed away), and surfaced in the UI as an "ignored"
 * warning rather than a disabled rung. For AGENT grantees (set-semantics, no
 * inheritance) the caller passes `unsetHint` so the unset state is legible as a
 * default rather than an inherited value.
 */
export function LevelControl({
  area,
  value,
  inherited,
  ignored = false,
  onChange,
  disabled = false,
  unsetHint,
  resetTooltip = 'Reset to inherited',
}: LevelControlProps) {
  const levels = useMemo<Level[]>(
    () => [Level.None, ...area.rungs.map((r) => r.level)],
    [area.rungs]
  )
  const effective = value ?? inherited
  const isExplicit = value !== undefined
  // Clamp the highlighted segment to the area's own ladder: a level above the top
  // rung (owner/admin `baseLevel: Full` on the Read-only `auditLog` area) or
  // between rungs (a baseline of Edit on a Read/Full ladder) composes down to the
  // highest rung at or below it — highlighting `effective` verbatim would match
  // no segment and render the row as if the holder had no access.
  const displayed = clampToArea(area, effective)

  return (
    <div className='flex items-center gap-1'>
      <Tooltip content='This override is ignored. The member baseline already grants this level of access.'>
        <AlertTriangle
          className={cn('size-3.5 text-amber-500', !ignored && 'invisible')}
          aria-hidden={!ignored}
        />
      </Tooltip>
      {unsetHint !== undefined && (
        <span
          className={cn(
            'text-xs text-muted-foreground whitespace-nowrap',
            isExplicit && 'invisible'
          )}
          aria-hidden={isExplicit}>
          {unsetHint}
        </span>
      )}
      <Tooltip content={resetTooltip}>
        <Button
          type='button'
          size='icon-sm'
          variant='ghost'
          aria-label={resetTooltip}
          disabled={disabled || !isExplicit}
          className={cn('size-6 text-muted-foreground', !isExplicit && 'invisible')}
          onClick={() => onChange(undefined)}>
          <Undo2 />
        </Button>
      </Tooltip>
      {/*
        Fixed-width slot for the ladder, so every row's hint/reset cluster starts
        at the same x whatever the area's rung count. The min-width belongs HERE
        and not on `RadioTab`: that component's own container is the grey pill, so
        widening it would stretch an empty pill behind a 2-rung toggle. The
        wrapper keeps the pill content-sized and pins it right instead.
        `min-w-` (not `w-`) so a hypothetical 5-rung area overflows the slot and
        renders correctly-but-unaligned rather than clipped. 52 = 208px is the
        smallest 0.25rem step that clears the widest ladder we ship —
        None/Read/Edit/Full measures 206.4px (4 × (px-2.5 = 20px + the 30.6px
        `text-xs`/500 "None") + the pill's 4px p-0.5).
      */}
      <div className='flex min-w-52 justify-end'>
        <RadioTab
          value={String(displayed)}
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
              {RUNG_LABELS[level]}
            </RadioTabItem>
          ))}
        </RadioTab>
      </div>
    </div>
  )
}
