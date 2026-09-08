// packages/lib/src/dashboards/draft-edit/__tests__/support/fixtures.ts
//
// Shared doc builders and an in-memory `Dashboard` row double. Not a test file.

import type { Database } from '@auxx/database'
import type {
  DashboardLayoutDoc,
  GridPosition,
  LayoutTab,
  LayoutWidget,
  WidgetConfiguration,
} from '../../../client'

const POSITION: GridPosition = { column: 0, row: 0, columnSpan: 3, rowSpan: 2 }

/** A widget. Defaults to an empty rich-text note, the simplest valid shape. */
export function widget(
  id: string,
  title: string,
  configuration: WidgetConfiguration = { kind: 'richText', content: null }
): LayoutWidget {
  return { id, title, type: configuration.kind, gridPosition: { ...POSITION }, configuration }
}

export function tab(id: string, title: string, widgets: LayoutWidget[] = []): LayoutTab {
  return { id, title, icon: null, widgets }
}

export function doc(tabs: LayoutTab[]): DashboardLayoutDoc {
  return { tabs }
}

/** A fully configured bar chart: publishable, no issues. */
export function configuredBarChart(): WidgetConfiguration {
  return {
    kind: 'barChart',
    source: { kind: 'entity', entityDefinitionId: 'def_1' },
    metric: { op: 'count' },
    groupBy: { fieldRef: 'def_1:status' as never },
  } as WidgetConfiguration
}

export interface FakeDashboardRow {
  id: string
  organizationId: string
  draftLayout: unknown
  archivedAt: Date | null
  activeVersionId: string | null
  entityDefinitionId: string | null
  hasUnpublishedChanges: boolean
}

export interface FakeDb {
  db: Database
  row: FakeDashboardRow
  updates: Array<Record<string, unknown>>
}

/**
 * A `Database` double covering exactly the three calls this module makes:
 * the `Dashboard` lookup, the active-version lookup, and the row update.
 * The `where` clauses are ignored: the row identity is fixed by construction.
 */
export function makeDb(
  over: Partial<FakeDashboardRow> = {},
  activeVersion?: { configHash: string }
): FakeDb {
  const row: FakeDashboardRow = {
    id: 'dash_1',
    organizationId: 'org_1',
    draftLayout: null,
    archivedAt: null,
    activeVersionId: null,
    entityDefinitionId: null,
    hasUnpublishedChanges: false,
    ...over,
  }
  const updates: Array<Record<string, unknown>> = []
  const db = {
    query: {
      Dashboard: { findFirst: async () => row },
      DashboardVersion: { findFirst: async () => activeVersion },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values)
          Object.assign(row, values)
        },
      }),
    }),
  }
  return { db: db as unknown as Database, row, updates }
}
