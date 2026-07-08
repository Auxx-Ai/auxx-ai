// apps/web/src/components/dashboard/lib/chart-palettes.test.ts

import { CHART_PALETTE_IDS, normalizePaletteId } from '@auxx/lib/dashboards/client'
import { describe, expect, it } from 'vitest'
import { CHART_PALETTES, previewSwatches, seriesColors } from './chart-palettes'

describe('CHART_PALETTES', () => {
  it('lists every id, default first', () => {
    expect(CHART_PALETTES.map((p) => p.id)).toEqual(CHART_PALETTE_IDS)
    expect(CHART_PALETTES[0].id).toBe('default')
    expect(CHART_PALETTES.every((p) => p.label.length > 0)).toBe(true)
  })
})

describe('seriesColors — default scheme', () => {
  it('returns one Radix var per series, cycling the hue spread', () => {
    // Third default hue is turquoise → Twenty's rename of Radix `teal`.
    expect(seriesColors('default', 3)).toEqual(['var(--blue-9)', 'var(--amber-9)', 'var(--teal-9)'])
  })

  it('maps turquoise to the Radix teal scale', () => {
    expect(seriesColors('turquoise', 1)).toEqual(['var(--teal-9)'])
  })

  it('cycles without wrapping before the 10th series', () => {
    const colors = seriesColors('default', 10)
    // 12 default hues > 10 series → all distinct.
    expect(new Set(colors).size).toBe(10)
  })
})

describe('seriesColors — mono scheme', () => {
  it('uses the solid shade for a single series', () => {
    expect(seriesColors('blue', 1)).toEqual(['var(--blue-9)'])
  })

  it('fans out a light → dark ramp for a breakdown', () => {
    const steps = seriesColors('blue', 5).map((c) => Number(c.match(/-(\d+)\)$/)![1]))
    // Monotonic non-decreasing (light → dark), within Radix's 1–12 range.
    expect(steps[0]).toBeLessThan(steps[steps.length - 1])
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1])
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(1)
    expect(Math.max(...steps)).toBeLessThanOrEqual(12)
  })

  it('every color references the scheme hue scale', () => {
    expect(seriesColors('crimson', 4).every((c) => c.startsWith('var(--crimson-'))).toBe(true)
  })
})

describe('seriesColors — edge cases', () => {
  it('returns [] for a non-positive count', () => {
    expect(seriesColors('blue', 0)).toEqual([])
    expect(seriesColors('default', -1)).toEqual([])
  })
})

describe('previewSwatches', () => {
  it('always returns 5 swatches', () => {
    expect(previewSwatches('default')).toHaveLength(5)
    expect(previewSwatches('blue')).toHaveLength(5)
  })
})

describe('normalizePaletteId', () => {
  it('passes valid ids through', () => {
    expect(normalizePaletteId('blue')).toBe('blue')
    expect(normalizePaletteId('default')).toBe('default')
  })

  it('folds legacy / unknown values to default', () => {
    expect(normalizePaletteId('auto')).toBe('default')
    expect(normalizePaletteId('var(--chart-3)')).toBe('default')
    expect(normalizePaletteId(undefined)).toBe('default')
    expect(normalizePaletteId(null)).toBe('default')
  })
})
