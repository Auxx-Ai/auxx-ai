// packages/lib/src/dashboards/draft-edit/__tests__/validate.test.ts
//
// `publishable` is the value the model quotes when it tells a user "ready to
// publish", so the matrix below asserts it against `dashboardLayoutDocSchema`
// itself for every doc: the point of the design is that the two cannot drift,
// and this test is what holds that. The per-widget issues are checked
// separately, because severity and publishability are different questions.

import { describe, expect, it } from 'vitest'
import type { DashboardLayoutDoc, WidgetConfiguration } from '../../client'
import { dashboardLayoutDocSchema } from '../../config-schemas'
import type { Issue } from '../types'
import { hasBlockingIssues, validateDashboard, widgetIssues } from '../validate'
import { configuredBarChart, doc, tab, widget } from './support/fixtures'

const ref = 'def_1:status' as never

const cases: Array<{ name: string; doc: DashboardLayoutDoc }> = [
  { name: 'no tabs at all', doc: doc([]) },
  { name: 'one empty tab', doc: doc([tab('tab_1', 'Overview')]) },
  {
    name: 'fully configured bar chart',
    doc: doc([tab('tab_1', 'Overview', [widget('w1', 'Revenue', configuredBarChart())])]),
  },
  {
    name: 'bar chart with no group-by',
    doc: doc([
      tab('tab_1', 'Overview', [
        widget('w1', 'Revenue', {
          kind: 'barChart',
          source: { kind: 'entity', entityDefinitionId: 'def_1' },
          metric: { op: 'count' },
        } as unknown as WidgetConfiguration),
      ]),
    ]),
  },
  {
    name: 'bar chart with no source',
    doc: doc([
      tab('tab_1', 'Overview', [
        widget('w1', 'Revenue', {
          kind: 'barChart',
          metric: { op: 'count' },
          groupBy: { fieldRef: ref },
        } as unknown as WidgetConfiguration),
      ]),
    ]),
  },
  {
    name: 'gauge with no rangeMax',
    doc: doc([
      tab('tab_1', 'Overview', [
        widget('w1', 'Target', {
          kind: 'gauge',
          source: { kind: 'entity', entityDefinitionId: 'def_1' },
          metric: { op: 'count' },
        } as unknown as WidgetConfiguration),
      ]),
    ]),
  },
  {
    name: 'kpi with a sum metric but no field',
    doc: doc([
      tab('tab_1', 'Overview', [
        widget('w1', 'Total', {
          kind: 'kpi',
          source: { kind: 'entity', entityDefinitionId: 'def_1' },
          metric: { op: 'sum' },
        } as unknown as WidgetConfiguration),
      ]),
    ]),
  },
  {
    name: 'recordList with no columns',
    doc: doc([
      tab('tab_1', 'Overview', [
        widget('w1', 'Tickets', {
          kind: 'recordList',
          source: { kind: 'entity', entityDefinitionId: 'def_1' },
          columns: [],
        } as unknown as WidgetConfiguration),
      ]),
    ]),
  },
  {
    name: 'iframe with a null url',
    doc: doc([tab('tab_1', 'Overview', [widget('w1', 'Embed', { kind: 'iframe', url: null })])]),
  },
  {
    name: 'empty rich text',
    doc: doc([tab('tab_1', 'Overview', [widget('w1', 'Note')])]),
  },
  {
    name: 'duplicate widget ids across tabs',
    doc: doc([
      tab('tab_1', 'Overview', [widget('w1', 'A')]),
      tab('tab_2', 'Support', [widget('w1', 'B')]),
    ]),
  },
  {
    name: 'field ref rooted in another def than the widget source',
    doc: doc([
      tab('tab_1', 'Overview', [
        widget('w1', 'Revenue', {
          kind: 'barChart',
          source: { kind: 'entity', entityDefinitionId: 'def_1' },
          metric: { op: 'count' },
          groupBy: { fieldRef: 'def_2:status' as never },
        } as unknown as WidgetConfiguration),
      ]),
    ]),
  },
]

describe('validateDashboard: publishable never drifts from the publish schema', () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const expected = dashboardLayoutDocSchema.safeParse(testCase.doc).success
      expect(validateDashboard(testCase.doc).publishable).toBe(expected)
    })
  }
})

const messagesFor = (issues: Issue[]) => issues.map((i) => i.message).join(' | ')

describe('per-widget issues', () => {
  it('names the widget by a ref the caller can echo back', () => {
    const layout = doc([
      tab('tab_1', 'Overview', [widget('w1', 'Embed', { kind: 'iframe', url: null })]),
    ])
    const { issues } = validateDashboard(layout)
    expect(issues[0]?.widgetRef).toBe('Embed')
  })

  it('reports a chart with no source, no metric field and no group-by, separately', () => {
    const config = { kind: 'barChart', metric: { op: 'sum' } } as unknown as WidgetConfiguration
    const issues = widgetIssues(widget('w1', 'Revenue', config), 'Revenue')
    expect(messagesFor(issues)).toContain('no data source')
    expect(messagesFor(issues)).toContain('names no field to aggregate')
    expect(messagesFor(issues)).toContain('no group-by field')
  })

  // The one check `isChartConfigured` does not make: a gauge draws a needle
  // against a target, and without one there is no scale.
  it('reports a gauge with no maximum', () => {
    const config = {
      kind: 'gauge',
      source: { kind: 'entity', entityDefinitionId: 'def_1' },
      metric: { op: 'count' },
    } as unknown as WidgetConfiguration
    expect(messagesFor(widgetIssues(widget('w1', 'Target', config), 'Target'))).toContain(
      'no maximum value'
    )
  })

  it('reports a recordList with no columns', () => {
    const config = {
      kind: 'recordList',
      source: { kind: 'entity', entityDefinitionId: 'def_1' },
      columns: [],
    } as unknown as WidgetConfiguration
    expect(messagesFor(widgetIssues(widget('w1', 'Tickets', config), 'Tickets'))).toContain(
      'shows no columns'
    )
  })

  // An empty note is a legitimate placeholder, not a broken widget.
  it('treats empty rich text as a WARNING, not an error', () => {
    const issues = widgetIssues(widget('w1', 'Note'), 'Note')
    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
    expect(hasBlockingIssues(issues)).toBe(false)
  })

  it('reports nothing for a fully configured widget', () => {
    expect(widgetIssues(widget('w1', 'Revenue', configuredBarChart()), 'Revenue')).toEqual([])
  })
})

describe('severity and publishability are different questions', () => {
  // Documented in validate.ts: the strict schema accepts a nullable iframe url,
  // so a caller asking "can I publish" must read `publishable`, not count errors.
  it('an error-severity issue does not by itself block publish', () => {
    const layout = doc([
      tab('tab_1', 'Overview', [widget('w1', 'Embed', { kind: 'iframe', url: null })]),
    ])
    const { issues, publishable } = validateDashboard(layout)
    expect(hasBlockingIssues(issues)).toBe(true)
    expect(publishable).toBe(true)
  })

  it('a schema failure is reported at its path with the widget it belongs to', () => {
    const config = {
      kind: 'gauge',
      source: { kind: 'entity', entityDefinitionId: 'def_1' },
      metric: { op: 'count' },
    } as unknown as WidgetConfiguration
    const layout = doc([tab('tab_1', 'Overview', [widget('w1', 'Target', config)])])
    const { issues, publishable } = validateDashboard(layout)
    expect(publishable).toBe(false)
    const schemaIssue = issues.find((i) => i.message.startsWith('tabs.0.widgets.0'))
    expect(schemaIssue).toBeDefined()
    expect(schemaIssue?.widgetRef).toBe('Target')
  })
})
