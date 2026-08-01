// apps/web/src/components/dashboard/lib/chart-palettes.ts
//
// The single source of truth for chart color SCHEMES (plan 12). Pure + client-
// safe. A scheme id (`ChartPaletteId`) derives every series color: single-hue
// schemes fan out a monochromatic shade ramp; `'default'` spreads distinct hues.
//
// Colors are returned as `var(--<scale>-N)` references into the Radix Colors
// scales imported in `global.css` (light + dark, theme-aware by construction —
// Radix redefines each `--<scale>-N` under our `.dark` root). We reference the
// LEAF Radix token directly rather than an intermediate `--pal-*` alias: a
// `:root`-declared alias would resolve its `var()` at `:root` (light) and inherit
// that fixed value, so it would NOT flip in dark subtrees. The leaf token is what
// Radix redefines per theme, so `var(--blue-9)` on a chart element inside `.dark`
// correctly reads the dark shade.

import { CHART_PALETTE_IDS, type ChartPaletteId } from '@auxx/lib/dashboards/client'

export type PaletteDef = { id: ChartPaletteId; label: string }

/**
 * A single-hue scheme id → its Radix Colors scale name. Twenty renames Radix's
 * `teal` to `turquoise`; every other id maps 1:1. This map is the ONE place the
 * hue naming is bridged to the CSS var namespace.
 */
const RADIX_SCALE: Record<Exclude<ChartPaletteId, 'default'>, string> = {
  red: 'red',
  ruby: 'ruby',
  crimson: 'crimson',
  tomato: 'tomato',
  orange: 'orange',
  amber: 'amber',
  yellow: 'yellow',
  lime: 'lime',
  grass: 'grass',
  green: 'green',
  jade: 'jade',
  mint: 'mint',
  turquoise: 'teal',
  cyan: 'cyan',
  sky: 'sky',
  blue: 'blue',
  iris: 'iris',
  violet: 'violet',
  purple: 'purple',
  plum: 'plum',
  pink: 'pink',
  bronze: 'bronze',
  gold: 'gold',
  brown: 'brown',
  gray: 'gray',
}

/** Human labels for the dropdown, in `CHART_PALETTE_IDS` order (`'default'` first). */
const PALETTE_LABELS: Record<ChartPaletteId, string> = {
  default: 'Default',
  red: 'Red',
  ruby: 'Ruby',
  crimson: 'Crimson',
  tomato: 'Tomato',
  orange: 'Orange',
  amber: 'Amber',
  yellow: 'Yellow',
  lime: 'Lime',
  grass: 'Grass',
  green: 'Green',
  jade: 'Jade',
  mint: 'Mint',
  turquoise: 'Turquoise',
  cyan: 'Cyan',
  sky: 'Sky',
  blue: 'Blue',
  iris: 'Iris',
  violet: 'Violet',
  purple: 'Purple',
  plum: 'Plum',
  pink: 'Pink',
  bronze: 'Bronze',
  gold: 'Gold',
  brown: 'Brown',
  gray: 'Gray',
}

/** The scheme def for an id — total, since `PALETTE_LABELS` covers every id. */
export function paletteDef(id: ChartPaletteId): PaletteDef {
  return { id, label: PALETTE_LABELS[id] }
}

/** Every scheme, `'default'` first — drives the dropdown list. */
export const CHART_PALETTES: PaletteDef[] = CHART_PALETTE_IDS.map(paletteDef)

// ── Shade selection (the visual-tuning knob — see plan 12) ───────────────────

/** Radix's "solid" step — the pure brand color, used for a single series + `default`. */
const SOLID_STEP = 9
/** Mono-ramp range across Radix's 12 steps (light → dark), avoiding the extremes. */
const MONO_LO = 4
const MONO_HI = 11

/**
 * The multi-hue spread for the `'default'` scheme — one strong (`SOLID_STEP`)
 * shade per hue, cycled by series index. Long enough (> {@link MAX_SERIES}) that a
 * full breakdown never wraps back onto a repeated hue before the `Other` bucket.
 */
const DEFAULT_HUES = [
  'blue',
  'amber',
  'turquoise',
  'pink',
  'violet',
  'lime',
  'orange',
  'cyan',
  'crimson',
  'iris',
  'jade',
  'gold',
] as const satisfies ReadonlyArray<Exclude<ChartPaletteId, 'default'>>

const cssVar = (scale: string, step: number) => `var(--${scale}-${step})`

/** `count` shade steps spread across the mono ramp (light → dark). Single → solid. */
function monoSteps(count: number): number[] {
  if (count <= 1) return [SOLID_STEP]
  return Array.from({ length: count }, (_, i) =>
    Math.round(MONO_LO + (i * (MONO_HI - MONO_LO)) / (count - 1))
  )
}

/**
 * `count` series colors for a scheme.
 * - **mono** → `count` shades of the hue (light → dark; a single series → the solid shade).
 * - **default** → the {@link DEFAULT_HUES} spread, cycled by index.
 */
export function seriesColors(id: ChartPaletteId, count: number): string[] {
  if (count <= 0) return []
  if (id === 'default') {
    return Array.from({ length: count }, (_, i) => {
      // `i % length` is always in range; `[0]` is only there to satisfy the checker.
      const hue = DEFAULT_HUES[i % DEFAULT_HUES.length] ?? DEFAULT_HUES[0]
      return cssVar(RADIX_SCALE[hue], SOLID_STEP)
    })
  }
  const scale = RADIX_SCALE[id]
  return monoSteps(count).map((step) => cssVar(scale, step))
}

/** The 5 colors shown in the dropdown's swatch-stack preview (Twenty shows 5). */
export function previewSwatches(id: ChartPaletteId): string[] {
  return seriesColors(id, 5)
}
