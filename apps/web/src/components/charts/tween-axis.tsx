// apps/web/src/components/charts/tween-axis.tsx
'use client'

import { useState } from 'react'
import { Text } from 'recharts'
import type { Tween } from '~/hooks/use-tween'

/** How long a scale tween runs; shared so every chart in a page moves at one speed. */
export const TWEEN_MS = 250

/** What recharts' `Customized` hands a layer for one axis: the scale after the tween. */
export interface ChartAxis {
  scale: (value: number) => number
}

/** The plot rect inside the chart's margins, as `Customized` passes it. */
export type PlotOffset = { left: number; top: number; width: number; height: number }

/** The last value that differed from the current one, or null before any change. */
export function usePreviousDistinct<T>(value: T): T | null {
  const [pair, setPair] = useState<{ current: T; prev: T | null }>({ current: value, prev: null })
  if (pair.current !== value) setPair({ current: value, prev: pair.current })
  return pair.current === value ? pair.prev : pair.current
}

/**
 * Ticks for one axis during a tween: the union of the old and new tick sets, clipped
 * to the eased domain, with leaving ticks fading out and arriving ticks fading in.
 */
export function tickSets(
  tween: Tween,
  at: number,
  make: (lo: number, hi: number) => number[]
): { ticks: number[]; opacity: (value: number) => number } {
  const [lo, hi] = [tween.current[at] ?? 0, tween.current[at + 1] ?? 0]
  const to = make(tween.to[at] ?? 0, tween.to[at + 1] ?? 0)
  if (tween.progress >= 1) return { ticks: to, opacity: () => 1 }
  const from = make(tween.from[at] ?? 0, tween.from[at + 1] ?? 0)
  const toSet = new Set(to)
  const fromSet = new Set(from)
  const ticks = [...new Set([...from, ...to])]
    .filter((t) => t >= lo && t <= hi)
    .sort((a, b) => a - b)
  const opacity = (value: number) =>
    toSet.has(value) ? (fromSet.has(value) ? 1 : tween.progress) : 1 - tween.progress
  return { ticks, opacity }
}

/** An axis tick that takes its opacity from the tween instead of a CSS transition (recharts remounts ticks per frame). */
export function FadeTick({
  payload,
  opacity,
  format,
  tickFormatter: _tickFormatter,
  visibleTicksCount: _count,
  index: _index,
  ...rest
}: {
  payload: { value: number }
  opacity: (value: number) => number
  format: (value: number) => string
  tickFormatter?: unknown
  visibleTicksCount?: number
  index?: number
} & Record<string, unknown>) {
  return (
    <Text
      {...(rest as object)}
      className='recharts-cartesian-axis-tick-value'
      style={{ opacity: opacity(payload.value) }}>
      {format(payload.value)}
    </Text>
  )
}
