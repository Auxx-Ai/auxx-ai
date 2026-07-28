// apps/web/src/components/permissions/ui/level-control.tsx
'use client'

import { type AreaMetadata, clampLevelToArea, Level } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { cn } from '@auxx/ui/lib/utils'
import { AlertTriangle, Undo2 } from 'lucide-react'
import { useMemo } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { RUNG_LABELS } from './level-labels'

/**
 * {@link clampLevelToArea} for callers already holding the area's metadata — the
 * highest rung `area` actually offers at or below `level`.
 *
 * Exported because callers need the same answer the control displays: an agent
 * policy's collection default is one rung for every area at once, so a row must
 * be able to name what that default resolves to *here* rather than repeating a
 * rung the area cannot express. The rule itself lives in the registry, because
 * the publish-time author clamp has to normalize by exactly the same ladder.
 */
export function clampToArea(area: AreaMetadata, level: Level): Level {
  return clampLevelToArea(area.area, level)
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
 * warning rather than a disabled rung.
 *
 * **The fall-through hint is NOT here.** It used to render in this trailing
 * cluster as an `unsetHint` prop, which put "Not set · no access" at the far
 * right of the row, hard against the ladder it describes. It now lives in the
 * row's `secondary` slot beside the title — see `ProfileAreaGrid`'s
 * `ProfileAreaRow`, its only caller. Two things fell out: the hint no longer
 * has to reserve width in this cluster to keep rows aligned (it was rendered
 * `invisible` rather than dropped, purely for layout), and it now sits with the
 * other left-side row state instead of competing with the control.
 */
export function LevelControl({
  area,
  value,
  inherited,
  ignored = false,
  onChange,
  disabled = false,
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
      {/*
        Fixed-width slot holding the reset button AND the ladder, right-pinned so
        every row's ladder ends at the same x whatever the area's rung count.

        The reset button lives INSIDE the slot (it used to sit outside, left of
        it) so it hugs the pill it acts on. Outside, it was separated from the
        pill by however much of the slot a narrow ladder left empty — on a 2-rung
        None/Full toggle that gap was most of the slot's width, and the button
        read as belonging to nothing. The trade is deliberate: reset buttons no
        longer share an x across rows, because "next to its own picker" beats
        "aligned with a picker three rows up".

        The min-width belongs HERE and not on `RadioTab`: that component's own
        container is the grey pill, so widening it would stretch an empty pill
        behind a 2-rung toggle. This wrapper keeps the pill content-sized and
        pins the group right instead. `min-w-` (not `w-`) so a hypothetical
        5-rung area overflows and renders correctly-but-unaligned rather than
        clipped.

        60 = 240px, re-derived for the new contents (it was 52 = 208px when the
        slot held the ladder alone): the widest ladder we ship,
        None/Read/Edit/Full, measures 206.4px — 4 × (px-2.5 = 20px + the 30.6px
        `text-xs`/500 "None") + the pill's 4px p-0.5 — plus the size-6 (24px)
        button and the 4px gap-1 = 234.4px. 240 is the smallest 0.25rem step that
        clears it, with 5.6px of slack.
      */}
      <div className='flex min-w-60 items-center justify-end gap-1'>
        <Tooltip content={resetTooltip}>
          <Button
            type='button'
            size='icon-sm'
            variant='ghost'
            aria-label={resetTooltip}
            disabled={disabled || !isExplicit}
            className={cn('size-6 shrink-0 text-muted-foreground', !isExplicit && 'invisible')}
            onClick={() => onChange(undefined)}>
            <Undo2 />
          </Button>
        </Tooltip>
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
