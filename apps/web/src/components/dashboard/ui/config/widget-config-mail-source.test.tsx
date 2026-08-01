// apps/web/src/components/dashboard/ui/config/widget-config-mail-source.test.tsx
//
// Half one of "no widget kind may OFFER a mail table as a data source": every
// data body wires `excludeMailLensTables`.
//
// `thread` / `message` are refused by both generic server paths a widget can
// take — rows (`record.listFiltered` → `assertNotMailLensTable`) and aggregates
// (`prepareAggregate`) — so a source the picker still offers can only produce a
// widget that renders "Data source unavailable". The record-list body was gated
// first; this pins the other five, which is the half that was missing.
//
// Half two — that the flag actually removes them from the offer list — is
// `data-source-section-mail-lens.test.tsx`, and it has to be a separate file:
// this one stubs `./data-source-section` to read the prop, which would also stub
// the component under test there. Asserting only this half would pass with a
// no-op prop; asserting only the other would pass with five bodies that never
// set it.

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Props every `DataSourceSection` mount received. */
  sections: [] as Array<{ excludeMailLensTables?: boolean }>,
}))

vi.mock('./data-source-section', () => ({
  DataSourceSection: (props: { excludeMailLensTables?: boolean }) => {
    h.sections.push(props)
    return null
  },
}))

import type { WidgetConfiguration } from '@auxx/lib/dashboards/client'
import { WidgetConfigBody } from './widget-config-bodies'

/** Every kind that carries a `source` — i.e. every kind this gate must cover. */
const DATA_WIDGET_CONFIGS = [
  { kind: 'barChart', metric: { op: 'count' } },
  { kind: 'lineChart', metric: { op: 'count' } },
  { kind: 'pieChart', metric: { op: 'count' } },
  { kind: 'kpi', metric: { op: 'count' } },
  { kind: 'gauge', metric: { op: 'count' }, rangeMax: 100 },
  { kind: 'recordList', columns: [] },
] as unknown as WidgetConfiguration[]

beforeEach(() => {
  h.sections.length = 0
})

describe('widget config bodies', () => {
  it.each(
    DATA_WIDGET_CONFIGS.map((config) => [config.kind, config] as const)
  )('%s excludes the mail tables from its source picker', (_kind, config) => {
    render(<WidgetConfigBody config={config} onChange={() => {}} />)

    expect(h.sections).toHaveLength(1)
    expect(h.sections[0]?.excludeMailLensTables).toBe(true)
  })

  it('covers every data widget kind', () => {
    // The list above is hand-written; if a seventh source-bearing kind lands,
    // this is the assertion that notices the gate was never extended to it.
    expect(DATA_WIDGET_CONFIGS.map((c) => c.kind).sort()).toEqual([
      'barChart',
      'gauge',
      'kpi',
      'lineChart',
      'pieChart',
      'recordList',
    ])
  })
})
