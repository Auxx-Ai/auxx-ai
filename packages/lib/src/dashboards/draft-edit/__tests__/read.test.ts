// packages/lib/src/dashboards/draft-edit/__tests__/read.test.ts
//
// The model-facing projections. Two properties matter: grid coordinates never
// leave the server (placement is automatic, so a model that can see positions
// will try to set them), and a widget's config is ONE truncated line, because
// re-emitting a whole configured dashboard per tool result burns the turn
// budget and invites the truncation that reads as deletion.

import { describe, expect, it } from 'vitest'
import type { WidgetConfiguration } from '../../client'
import { buildLayoutSummary, buildWidgetSummary, summarizeWidgetConfig } from '../read'
import { configuredBarChart, doc, tab, widget } from './support/fixtures'

const gauge = {
  kind: 'gauge',
  source: { kind: 'entity', entityDefinitionId: 'def_1' },
  metric: { op: 'count' },
} as unknown as WidgetConfiguration

const sample = doc([
  tab('tab_1', 'Overview', [
    widget('w1', 'Revenue', configuredBarChart()),
    widget('w2', 'Target', gauge),
  ]),
  tab('tab_2', 'Notes', [widget('w3', 'Note')]),
])

describe('buildWidgetSummary', () => {
  it('carries the ref, tab, kind and configured flag, and NO grid position', () => {
    const summary = buildWidgetSummary(sample, sample.tabs[0]!.widgets[0]!, sample.tabs[0]!)
    expect(summary).toMatchObject({ ref: 'Revenue', id: 'w1', tab: 'Overview', kind: 'barChart' })
    expect(summary.configured).toBe(true)
    expect(JSON.stringify(summary)).not.toContain('columnSpan')
  })

  it('marks a gauge with no maximum unconfigured', () => {
    const summary = buildWidgetSummary(sample, sample.tabs[0]!.widgets[1]!, sample.tabs[0]!)
    expect(summary.configured).toBe(false)
  })

  it('treats a rich-text note as configured: it needs nothing to render', () => {
    const summary = buildWidgetSummary(sample, sample.tabs[1]!.widgets[0]!, sample.tabs[1]!)
    expect(summary.configured).toBe(true)
  })
})

describe('summarizeWidgetConfig', () => {
  it('drops the redundant kind and stays on one line', () => {
    const summary = summarizeWidgetConfig(configuredBarChart())
    expect(summary).not.toContain('barChart')
    expect(summary).toContain('def_1')
  })

  it('truncates a large body rather than shipping it', () => {
    const big = { kind: 'richText', content: { text: 'x'.repeat(500) } } as WidgetConfiguration
    const summary = summarizeWidgetConfig(big)
    expect(summary).toHaveLength(140)
    expect(summary.endsWith('…')).toBe(true)
  })
})

describe('buildLayoutSummary', () => {
  it('counts tabs, widgets and the ones still missing config', () => {
    expect(buildLayoutSummary(sample)).toEqual({
      tabCount: 2,
      widgetCount: 3,
      unconfiguredCount: 1,
      tabs: [
        { ref: 'Overview', id: 'tab_1', widgetCount: 2 },
        { ref: 'Notes', id: 'tab_2', widgetCount: 1 },
      ],
    })
  })

  it('handles an empty doc', () => {
    expect(buildLayoutSummary(doc([]))).toEqual({
      tabCount: 0,
      widgetCount: 0,
      unconfiguredCount: 0,
      tabs: [],
    })
  })
})
