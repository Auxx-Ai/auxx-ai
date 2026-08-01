// packages/lib/src/dashboards/config-schemas.test.ts

import type { ResourceFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import {
  createStarterLayoutDoc,
  type DashboardLayoutDoc,
  isChartConfigured,
  type LayoutWidget,
  segmentToConditions,
} from './client'
import { hashLayoutDoc } from './config-hash'
import { dashboardLayoutDocSchema, draftLayoutDocSchema } from './config-schemas'

const rf = (s: string) => s as ResourceFieldId

function widget(overrides: Partial<LayoutWidget> = {}): LayoutWidget {
  return {
    id: 'w1',
    title: 'Tickets by status',
    type: 'barChart',
    gridPosition: { column: 0, row: 0, columnSpan: 6, rowSpan: 4 },
    configuration: {
      kind: 'barChart',
      source: { kind: 'entity', entityDefinitionId: 'ticket' },
      metric: { op: 'count' },
      groupBy: { fieldRef: rf('ticket:status') },
    },
    ...overrides,
  }
}

function doc(widgets: LayoutWidget[]): DashboardLayoutDoc {
  return { tabs: [{ id: 't1', title: 'Overview', icon: null, widgets }] }
}

describe('dashboardLayoutDocSchema', () => {
  it('accepts a valid single-widget doc', () => {
    expect(dashboardLayoutDocSchema.safeParse(doc([widget()])).success).toBe(true)
  })

  it('accepts the starter doc', () => {
    expect(dashboardLayoutDocSchema.safeParse(createStarterLayoutDoc()).success).toBe(true)
  })

  it('rejects a doc with zero tabs', () => {
    expect(dashboardLayoutDocSchema.safeParse({ tabs: [] }).success).toBe(false)
  })

  it('rejects widget type ≠ configuration.kind', () => {
    const bad = widget({ type: 'lineChart' }) // config is barChart
    expect(dashboardLayoutDocSchema.safeParse(doc([bad])).success).toBe(false)
  })

  it('rejects duplicate widget ids across the doc', () => {
    const a = widget({ id: 'dup' })
    const b = widget({ id: 'dup', title: 'Other' })
    expect(dashboardLayoutDocSchema.safeParse(doc([a, b])).success).toBe(false)
  })

  it('rejects duplicate tab ids', () => {
    const d: DashboardLayoutDoc = {
      tabs: [
        { id: 'same', title: 'A', icon: null, widgets: [] },
        { id: 'same', title: 'B', icon: null, widgets: [] },
      ],
    }
    expect(dashboardLayoutDocSchema.safeParse(d).success).toBe(false)
  })

  it('rejects a grid position that overflows 12 columns', () => {
    const bad = widget({ gridPosition: { column: 8, row: 0, columnSpan: 6, rowSpan: 4 } })
    expect(dashboardLayoutDocSchema.safeParse(doc([bad])).success).toBe(false)
  })

  it('rejects a field ref whose root def ≠ the entity source', () => {
    const bad = widget({
      configuration: {
        kind: 'barChart',
        source: { kind: 'entity', entityDefinitionId: 'ticket' },
        metric: { op: 'count' },
        groupBy: { fieldRef: rf('contact:status') }, // wrong root def
      },
    })
    expect(dashboardLayoutDocSchema.safeParse(doc([bad])).success).toBe(false)
  })

  it('allows a one-hop field path whose root def matches the source', () => {
    const ok = widget({
      configuration: {
        kind: 'barChart',
        source: { kind: 'entity', entityDefinitionId: 'ticket' },
        metric: { op: 'count' },
        groupBy: { fieldRef: [rf('ticket:company'), rf('company:name')] },
      },
    })
    expect(dashboardLayoutDocSchema.safeParse(doc([ok])).success).toBe(true)
  })

  it('rejects an iframe with a non-http url', () => {
    const bad = widget({
      type: 'iframe',
      configuration: { kind: 'iframe', url: 'ftp://example.com' },
    })
    expect(dashboardLayoutDocSchema.safeParse(doc([bad])).success).toBe(false)
  })
})

describe('draftLayoutDocSchema (permissive)', () => {
  // The unconfigured shells the store mints on add (widget-config-defaults.ts).
  // They are deliberately NOT valid strict `WidgetConfiguration`s (no `source`
  // yet) — accepting them is the whole point of the draft schema — so the cast
  // has to go through `unknown`.
  const shell = (config: object) => config as unknown as LayoutWidget['configuration']
  const barShell = (): LayoutWidget => ({
    id: 'w1',
    title: 'Bar chart',
    type: 'barChart',
    gridPosition: { column: 0, row: 0, columnSpan: 6, rowSpan: 4 },
    configuration: shell({ kind: 'barChart', metric: { op: 'count' } }),
  })
  const recordListShell = (): LayoutWidget => ({
    id: 'w2',
    title: 'Record list',
    type: 'recordList',
    gridPosition: { column: 0, row: 0, columnSpan: 6, rowSpan: 5 },
    configuration: shell({ kind: 'recordList', columns: [] }),
  })

  it('accepts an unconfigured chart shell (no source / group-by)', () => {
    expect(draftLayoutDocSchema.safeParse(doc([barShell()])).success).toBe(true)
  })

  it('accepts an unconfigured record-list shell (no source)', () => {
    expect(draftLayoutDocSchema.safeParse(doc([recordListShell()])).success).toBe(true)
  })

  it('accepts a fully configured doc too', () => {
    expect(draftLayoutDocSchema.safeParse(doc([widget()])).success).toBe(true)
  })

  it('still rejects structural violations (type ≠ kind)', () => {
    const bad = { ...barShell(), type: 'lineChart' as const }
    expect(draftLayoutDocSchema.safeParse(doc([bad])).success).toBe(false)
  })

  it('still rejects duplicate widget ids', () => {
    expect(draftLayoutDocSchema.safeParse(doc([barShell(), barShell()])).success).toBe(false)
  })

  it('still rejects an out-of-grid position', () => {
    const bad = {
      ...barShell(),
      gridPosition: { column: 8, row: 0, columnSpan: 6, rowSpan: 4 },
    }
    expect(draftLayoutDocSchema.safeParse(doc([bad])).success).toBe(false)
  })

  it('the STRICT schema rejects the same shells (publish gate)', () => {
    expect(dashboardLayoutDocSchema.safeParse(doc([barShell()])).success).toBe(false)
    expect(dashboardLayoutDocSchema.safeParse(doc([recordListShell()])).success).toBe(false)
  })
})

describe('hashLayoutDoc', () => {
  it('is invariant to object key order', () => {
    const a = { tabs: [{ id: 't1', title: 'A', icon: null, widgets: [] }] } as DashboardLayoutDoc
    const b = {
      tabs: [{ widgets: [], icon: null, title: 'A', id: 't1' }],
    } as unknown as DashboardLayoutDoc
    expect(hashLayoutDoc(a)).toBe(hashLayoutDoc(b))
  })

  it('changes when content changes', () => {
    const a = doc([widget()])
    const b = doc([widget({ title: 'Different' })])
    expect(hashLayoutDoc(a)).not.toBe(hashLayoutDoc(b))
  })
})

describe('isChartConfigured', () => {
  it('true for a count bar chart with a group-by', () => {
    expect(isChartConfigured(widget().configuration)).toBe(true)
  })

  it('false for a sum metric without a fieldRef', () => {
    const config = {
      kind: 'barChart' as const,
      source: { kind: 'entity' as const, entityDefinitionId: 'ticket' },
      metric: { op: 'sum' as const },
      groupBy: { fieldRef: rf('ticket:status') },
    }
    expect(isChartConfigured(config)).toBe(false)
  })

  it('false for a bar chart missing a group-by', () => {
    const config = {
      kind: 'barChart' as const,
      source: { kind: 'entity' as const, entityDefinitionId: 'ticket' },
      metric: { op: 'count' as const },
    } as never
    expect(isChartConfigured(config)).toBe(false)
  })

  it('true for a KPI (no group-by required)', () => {
    const config = {
      kind: 'kpi' as const,
      source: { kind: 'entity' as const, entityDefinitionId: 'ticket' },
      metric: { op: 'count' as const },
    }
    expect(isChartConfigured(config)).toBe(true)
  })
})

describe('segmentToConditions', () => {
  it('maps an option segment to an "is" condition on the field', () => {
    const groups = segmentToConditions(rf('ticket:status'), { kind: 'option', optionId: 'open' })
    expect(groups).toHaveLength(1)
    expect(groups[0]!.conditions).toHaveLength(1)
    expect(groups[0]!.conditions[0]).toMatchObject({
      fieldId: 'ticket:status',
      operator: 'is',
      value: 'open',
    })
  })

  it('maps the empty bucket to an "empty" operator', () => {
    const groups = segmentToConditions(rf('ticket:status'), { kind: 'empty' })
    expect(groups[0]!.conditions[0]).toMatchObject({ operator: 'empty' })
  })

  it('maps a date bucket to an after+before range', () => {
    const groups = segmentToConditions(rf('ticket:createdAt'), {
      kind: 'dateBucket',
      from: '2026-01-01',
      to: '2026-02-01',
    })
    expect(groups[0]!.conditions.map((c) => c.operator)).toEqual(['after', 'before'])
  })
})
