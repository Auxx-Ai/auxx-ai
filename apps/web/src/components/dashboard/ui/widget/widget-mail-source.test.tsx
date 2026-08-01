// apps/web/src/components/dashboard/ui/widget/widget-mail-source.test.tsx
//
// A STORED `thread` / `message` widget must degrade, not error.
//
// The query layer refuses mail tables outright (`assertNotMailLensTable` for
// rows, `prepareAggregate` for aggregates) because row visibility is not content
// authorization — `buildMailVisibilityPredicate` admits a row at `metadata`
// while reading a subject needs `identity`. That refusal is correct and is not
// what these tests exercise; what they pin is the consequence nobody sees until
// a saved dashboard reloads: every widget kind that could name `thread` before
// the gate landed still renders something a human can act on.
//
// Two assertions per kind, and the second is the one that rots first:
//   1. the body renders the unavailable state (not a red error, and not a
//      skeleton that never resolves — the query is disabled, so `data` never
//      arrives);
//   2. **no request is issued at all.** A guaranteed-403 fetch per mail widget
//      per dashboard load is the failure mode a purely error-driven degradation
//      would ship quietly.

import { TooltipProvider } from '@auxx/ui/components/tooltip'
import { render as rtlRender, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Every `useQuery` the widget bodies reached, with its `enabled` verdict. */
  queries: [] as Array<{ endpoint: string; enabled: boolean }>,
  /** Overrides the stubbed answer for one render (the FORBIDDEN suite). */
  answer: undefined as
    | undefined
    | { data: undefined; isLoading: boolean; isError: boolean; error: unknown },
}))

/** Records the call, then answers as a disabled query does: pending, no data. */
function stubQuery(endpoint: string) {
  return (_input: unknown, opts?: { enabled?: boolean }) => {
    const enabled = opts?.enabled !== false
    h.queries.push({ endpoint, enabled })
    if (h.answer) return h.answer
    return { data: undefined, isLoading: enabled, isError: false, error: null }
  }
}

vi.mock('~/trpc/react', () => ({
  api: {
    dashboard: {
      chartData: { useQuery: stubQuery('dashboard.chartData') },
      kpiData: { useQuery: stubQuery('dashboard.kpiData') },
    },
    record: { listFiltered: { useQuery: stubQuery('record.listFiltered') } },
  },
}))

// The table and the record cells are not under test — they are the heaviest
// thing in the record-list body's graph and they only mount on the happy path.
vi.mock('~/components/dynamic-table', () => ({
  DynamicTable: () => <div data-testid='dynamic-table' />,
  PrimaryFieldCell: () => null,
  CustomFieldCell: () => null,
  getIconForFieldType: () => null,
}))

vi.mock('~/components/resources', () => ({
  useResource: () => ({ resource: undefined }),
  useResourceFields: () => ({ fields: [] }),
}))

vi.mock('~/components/resources/hooks/use-field', () => ({
  useField: () => undefined,
  useFields: () => [],
}))

import type {
  BarChartConfig,
  GaugeConfig,
  KpiConfig,
  RecordListConfig,
  WidgetSource,
} from '@auxx/lib/dashboards/client'
import type { ReactElement } from 'react'
import { useDashboardStore } from '../../stores/dashboard-draft-store'
import { ChartWidget } from './chart-widget'
import { GaugeWidget } from './gauge-widget'
import { KpiWidget } from './kpi-widget'
import { RecordListWidget } from './record-list-widget'

const THREAD: WidgetSource = { kind: 'system', tableId: 'thread' }
const MESSAGE: WidgetSource = { kind: 'system', tableId: 'message' }
const CONTACT: WidgetSource = { kind: 'entity', entityDefinitionId: 'edf_contact' }

const UNAVAILABLE = 'Data source unavailable'

/** Fully configured widgets — the point is that config validity is irrelevant. */
const bodies: Record<string, (source: WidgetSource) => ReactElement> = {
  recordList: (source) => (
    <RecordListWidget
      config={{ kind: 'recordList', source, columns: [] } as RecordListConfig}
      widgetId='wgt_1'
      isEditMode={false}
    />
  ),
  chart: (source) => (
    <ChartWidget
      config={
        {
          kind: 'barChart',
          source,
          metric: { op: 'count' },
          groupBy: { fieldRef: 'thread:status' },
        } as BarChartConfig
      }
      widgetId='wgt_2'
      isEditMode={false}
    />
  ),
  kpi: (source) => (
    <KpiWidget
      config={{ kind: 'kpi', source, metric: { op: 'count' } } as KpiConfig}
      widgetId='wgt_3'
      isEditMode={false}
    />
  ),
  gauge: (source) => (
    <GaugeWidget
      config={{ kind: 'gauge', source, metric: { op: 'count' }, rangeMax: 100 } as GaugeConfig}
      widgetId='wgt_4'
      isEditMode={false}
    />
  ),
}

/** Mirrors the app shell (`global/auxx-app-providers.tsx`), which wraps every
 *  protected page in a `TooltipProvider` — the unavailable state's hover
 *  explanation is a Radix tooltip and needs one. */
const render = (ui: ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>)

const MAIL_SOURCES: Array<[string, WidgetSource]> = [
  ['thread', THREAD],
  ['message', MESSAGE],
]

beforeEach(() => {
  h.queries.length = 0
  h.answer = undefined
  // The hooks gate on a seeded dashboard id; without it every query is disabled
  // for an unrelated reason and the "no request" assertions pass vacuously.
  useDashboardStore.setState({ dashboardId: 'dsh_1' })
})

describe.each(Object.keys(bodies))('%s widget', (kind) => {
  const body = bodies[kind] as (source: WidgetSource) => ReactElement

  it.each(MAIL_SOURCES)('renders the unavailable state for a stored %s source', (_id, source) => {
    render(body(source))

    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument()
    expect(screen.queryByTestId('dynamic-table')).not.toBeInTheDocument()
  })

  it.each(MAIL_SOURCES)('issues no request for a stored %s source', (_id, source) => {
    render(body(source))

    expect(h.queries.filter((q) => q.enabled)).toEqual([])
  })

  it('leaves an entity source alone — it still fetches and shows no notice', () => {
    render(body(CONTACT))

    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument()
    expect(h.queries.filter((q) => q.enabled).length).toBeGreaterThan(0)
  })

  // The mirror in `lib/widget-source.ts` is a copy of a server allowlist and has
  // already drifted once (it offered `thread` as an aggregate source for a
  // release after the server stopped accepting it). A refusal the mirror does
  // not predict must still degrade rather than turn the tile red.
  it('falls back to the unavailable state on an unforeseen FORBIDDEN', () => {
    h.answer = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { message: 'Threads and messages are not readable', data: { code: 'FORBIDDEN' } },
    }

    render(body(CONTACT))

    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument()
  })

  it('still shows a real error for a non-FORBIDDEN failure', () => {
    h.answer = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { message: 'boom', data: { code: 'INTERNAL_SERVER_ERROR' } },
    }

    render(body(CONTACT))

    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument()
  })
})
