// packages/lib/src/seed/entity-seeder/__tests__/mrp-dashboard-widgets.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCachedEntityDefId: vi.fn(async () => 'def_part'),
  getCachedResource: vi.fn(async () => ({ plural: 'Parts', icon: 'package', color: 'blue' })),
}))
vi.mock('../../../users/system-user-service', () => ({
  SystemUserService: { getSystemUserForActions: vi.fn(async () => 'sys_user') },
}))
vi.mock('../../../dashboards/dashboard-mutations', () => ({
  insertPublishedDashboard: vi.fn(async () => 'dash_new'),
}))

import type { Database } from '@auxx/database'
import type { DashboardLayoutDoc } from '../../../dashboards/client'
import { dashboardLayoutDocSchema } from '../../../dashboards/config-schemas'
import { insertPublishedDashboard } from '../../../dashboards/dashboard-mutations'
import {
  buildMrpPlanningTab,
  ensureMrpDashboardWidgets,
  hasMrpPlanWidget,
} from '../mrp-dashboard-widgets'

/** One Parts dashboard held in memory; enough of Drizzle for the lookup and `appendPublishedTab`. */
function fakeDb(state: {
  dashboard?: { archivedAt: Date | null; active: DashboardLayoutDoc; draft: DashboardLayoutDoc }
  versions: DashboardLayoutDoc[]
}): Database {
  const dashboardRow = () =>
    state.dashboard
      ? {
          id: 'dash_1',
          archivedAt: state.dashboard.archivedAt,
          activeVersionId: 'v_active',
          draftLayout: state.dashboard.draft,
        }
      : undefined
  const chain = (rows: () => unknown[]) => {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.where = () => c
    c.for = async () => rows()
    c.limit = async () => rows()
    // biome-ignore lint/suspicious/noThenProperty: the version-number select is awaited bare
    c.then = (resolve: (v: unknown) => unknown) => resolve([{ next: state.versions.length + 1 }])
    return c
  }
  const tx = {
    select: () => chain(() => (dashboardRow() ? [dashboardRow()] : [])),
    query: {
      DashboardVersion: { findFirst: async () => ({ layout: state.dashboard?.active }) },
    },
    insert: () => ({
      values: async (v: { layout: DashboardLayoutDoc }) => {
        state.versions.push(v.layout)
        if (state.dashboard) state.dashboard.active = v.layout
      },
    }),
    update: () => ({
      set: (v: { draftLayout?: DashboardLayoutDoc }) => ({
        where: async () => {
          if (state.dashboard && v.draftLayout) state.dashboard.draft = v.draftLayout
        },
      }),
    }),
  }
  return {
    ...tx,
    transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Database
}

const emptyDoc = (): DashboardLayoutDoc => ({
  tabs: [{ id: 'tab_overview', title: 'Overview', icon: null, widgets: [] }],
})

beforeEach(() => vi.clearAllMocks())

describe('buildMrpPlanningTab', () => {
  it('builds six valid plan widgets that link into the action list', () => {
    const tab = buildMrpPlanningTab()
    expect(tab.widgets).toHaveLength(6)
    expect(dashboardLayoutDocSchema.safeParse({ tabs: [tab] }).success).toBe(true)
    for (const w of tab.widgets) {
      expect((w.configuration as { link?: string }).link).toMatch(/^\/app\/parts\/manage\/plan/)
    }
    expect(hasMrpPlanWidget([{ tabs: [tab] }])).toBe(true)
    expect(hasMrpPlanWidget([emptyDoc()])).toBe(false)
  })
})

describe('ensureMrpDashboardWidgets', () => {
  it('adds the tab once to an existing Parts dashboard, draft and published alike', async () => {
    const state = {
      dashboard: { archivedAt: null, active: emptyDoc(), draft: emptyDoc() },
      versions: [] as DashboardLayoutDoc[],
    }

    const first = await ensureMrpDashboardWidgets(fakeDb(state), 'org_1')
    expect(first._unsafeUnwrap()).toBe('added_tab')
    expect(state.versions).toHaveLength(1)
    expect(state.dashboard.active.tabs.map((t) => t.title)).toEqual(['Overview', 'Planning'])
    expect(state.dashboard.draft.tabs.map((t) => t.title)).toEqual(['Overview', 'Planning'])

    const second = await ensureMrpDashboardWidgets(fakeDb(state), 'org_1')
    expect(second._unsafeUnwrap()).toBe('skipped')
    expect(state.versions).toHaveLength(1)
  })

  it('leaves the dashboard alone while any plan widget is left, even after edits', async () => {
    const kept = buildMrpPlanningTab()
    kept.widgets = kept.widgets.slice(0, 1)
    const state = {
      dashboard: { archivedAt: null, active: emptyDoc(), draft: { tabs: [kept] } },
      versions: [] as DashboardLayoutDoc[],
    }
    const result = await ensureMrpDashboardWidgets(fakeDb(state), 'org_1')
    expect(result._unsafeUnwrap()).toBe('skipped')
    expect(state.versions).toHaveLength(0)
  })

  it('creates the Parts dashboard when there is none, and never resurrects an archived one', async () => {
    const created = await ensureMrpDashboardWidgets(fakeDb({ versions: [] }), 'org_1')
    expect(created._unsafeUnwrap()).toBe('created_dashboard')
    expect(insertPublishedDashboard).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      expect.objectContaining({ name: 'Parts Dashboard', entityDefinitionId: 'def_part' })
    )

    vi.mocked(insertPublishedDashboard).mockClear()
    const archived = {
      dashboard: { archivedAt: new Date(), active: emptyDoc(), draft: emptyDoc() },
      versions: [] as DashboardLayoutDoc[],
    }
    expect((await ensureMrpDashboardWidgets(fakeDb(archived), 'org_1'))._unsafeUnwrap()).toBe(
      'skipped'
    )
    expect(insertPublishedDashboard).not.toHaveBeenCalled()
    expect(archived.versions).toHaveLength(0)
  })
})
