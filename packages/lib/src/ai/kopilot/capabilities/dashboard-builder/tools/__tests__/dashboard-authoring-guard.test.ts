// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/__tests__/dashboard-authoring-guard.test.ts
//
// Security property, asserted by ENUMERATING the registered `dashboard.builder`
// capability set (the workflow-builder pattern): every tool routes through
// `resolveDashboardAuthoring` before it does anything else - fail-closed on
// absent capabilities, the `dashboardsView` area rung, org scope, the archived
// check, the per-dashboard instance rung, and (for mutations) the dirty gate.
//
// The args passed on denial cases are deliberately empty or garbage: the guard
// must run BEFORE argument validation, so a denial must surface even for a call
// the tool would otherwise reject on shape.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutMutationResult } from '../../../../../../dashboards/draft-edit'
import { ForbiddenError } from '../../../../../../errors'
import type { AgentToolDefinition, AgentToolResult } from '../../../../../agent-framework/types'
import type { GetToolDeps, ToolDeps } from '../../../types'

// ── Mocks ────────────────────────────────────────────────────────────────────

const APPLIED: LayoutMutationResult = {
  applied: true,
  widget: {
    ref: 'Open tickets',
    id: 'w-1',
    tab: 'Overview',
    kind: 'kpi',
    config: '{"metric":{"op":"count"}}',
    configured: true,
  },
  layoutSummary: {
    tabCount: 1,
    widgetCount: 1,
    unconfiguredCount: 0,
    tabs: [{ ref: 'Overview', id: 'tab-1', widgetCount: 1 }],
  },
  issues: [],
}

const opMock = vi.fn(async (..._args: unknown[]) => ok(APPLIED))
const changeTypeMock = vi.fn(async (..._args: unknown[]) =>
  ok({ ...APPLIED, droppedFieldsOnConvert: [] })
)

const DOC = {
  tabs: [
    {
      id: 'tab-1',
      title: 'Overview',
      icon: null,
      widgets: [
        {
          id: 'w-1',
          title: 'Open tickets',
          type: 'kpi',
          gridPosition: { column: 0, row: 0, columnSpan: 3, rowSpan: 2 },
          configuration: {
            kind: 'kpi',
            source: { kind: 'entity', entityDefinitionId: 'def-1' },
            metric: { op: 'count' },
          },
        },
      ],
    },
  ],
}

const loadDraftContext = vi.fn(async (..._a: unknown[]) =>
  ok({
    row: { name: 'Support', description: null, hasUnpublishedChanges: false },
    doc: DOC,
    layoutHash: 'hash-1',
    entityDefinitionId: null,
  })
)

vi.mock('../../../../../../dashboards/draft-edit', () => ({
  addWidget: (...a: unknown[]) => opMock(...a),
  updateWidget: (...a: unknown[]) => opMock(...a),
  changeWidgetType: (...a: unknown[]) => changeTypeMock(...a),
  arrangeWidgets: (...a: unknown[]) => opMock(...a),
  deleteWidgets: (...a: unknown[]) => opMock(...a),
  addTab: (...a: unknown[]) => opMock(...a),
  updateTab: (...a: unknown[]) => opMock(...a),
  deleteTab: (...a: unknown[]) => opMock(...a),
  setGlobalFilters: (...a: unknown[]) => opMock(...a),
  replaceLayout: (...a: unknown[]) => opMock(...a),
  loadDraftContext: (...a: unknown[]) => loadDraftContext(...a),
  buildLayoutSummary: () => APPLIED.layoutSummary,
  buildWidgetSummary: () => APPLIED.widget,
  validateDashboard: () => ({ issues: [], publishable: true }),
  widgetIssues: () => [],
  formatWidgetRef: () => 'Open tickets',
  resolveWidgetRef: () => ok({ widget: DOC.tabs[0]?.widgets[0], tab: DOC.tabs[0] }),
  resolveWidgetSource: async () => ok({ kind: 'entity', entityDefinitionId: 'def-1' }),
  describeSourceForOrg: async () => 'Tickets',
  describeFieldRef: () => 'Status',
  loadSourceFields: async () => [],
  resolveFieldRef: async () => ok('def-1:f-1'),
  normalizeFilters: async () => ok([]),
}))

const beginDashboardTurnLock = vi.fn(async (..._a: unknown[]) => {})
vi.mock('../../../../../../dashboards/draft-edit/turn-lock', () => ({
  beginDashboardTurnLock: (...a: unknown[]) => beginDashboardTurnLock(...a),
}))

const getCachedResources = vi.fn(async (..._a: unknown[]) => [
  {
    id: 'def-1',
    entityDefinitionId: 'def-1',
    apiSlug: 'tickets',
    label: 'Ticket',
    plural: 'Tickets',
    entityType: 'ticket',
    isVisible: true,
    fields: [],
  },
  {
    id: 'thread',
    entityDefinitionId: 'thread',
    apiSlug: 'threads',
    label: 'Thread',
    plural: 'Threads',
    entityType: 'thread',
    isVisible: true,
    fields: [],
  },
])
vi.mock('../../../../../../cache', () => ({
  getCachedResources: (...a: unknown[]) => getCachedResources(...a),
}))

const runAggregate = vi.fn(async (..._a: unknown[]) =>
  ok({ groups: [{ key: 'OPEN', label: 'Open', value: 7 }], totalValue: 7, hasMoreGroups: false })
)
const runKpi = vi.fn(async (..._a: unknown[]) => ok({ value: 7 }))
vi.mock('../../../../../../resources/aggregate', () => ({
  buildAggregateQueryForWidget: (input: unknown) => input,
  runAggregate: (...a: unknown[]) => runAggregate(...a),
  runKpi: (...a: unknown[]) => runKpi(...a),
  trendSpecForWidget: () => undefined,
  SYSTEM_AGGREGATE_TABLE_IDS: ['article'] as const,
}))

import { createDashboardBuilderCapabilities } from '../../index'
import {
  DASHBOARD_NOT_FOUND_ERROR,
  DIRTY_CANVAS_ERROR,
  NO_DASHBOARD_REF_ERROR,
} from '../dashboard-authoring-guard'

// ── Fixture ──────────────────────────────────────────────────────────────────

const ORG = 'org-1'
const DASH = 'dash-1'

type CapsStub = {
  can: ReturnType<typeof vi.fn>
  canViewEntity: ReturnType<typeof vi.fn>
  canViewInstance: ReturnType<typeof vi.fn>
  assertEditInstance: ReturnType<typeof vi.fn>
  assertAdminInstance: ReturnType<typeof vi.fn>
}

function makeCaps(): CapsStub {
  return {
    can: vi.fn(() => true),
    canViewEntity: vi.fn(() => true),
    canViewInstance: vi.fn(() => true),
    assertEditInstance: vi.fn(() => {}),
    assertAdminInstance: vi.fn(() => {}),
  }
}

/** Rows the guard's org-scope select resolves. */
let dashboardRows: Array<{ id: string }> = [{ id: DASH }]
const db = {
  select: () => ({
    from: () => ({ where: () => ({ limit: async () => dashboardRows }) }),
  }),
}

let caps: CapsStub | undefined
let refs: Array<Record<string, unknown>> = [{ kind: 'dashboard', id: DASH }]

const getDeps: GetToolDeps = () =>
  ({
    db,
    sessionContext: { page: 'dashboard.builder', references: refs },
    organizationId: ORG,
    userId: 'member-1',
    sessionId: 's-1',
    capabilities: caps,
  }) as unknown as ToolDeps

const agentDeps = {
  organizationId: ORG,
  userId: 'member-1',
  sessionId: 's-1',
  turnId: 'turn-1',
} as Parameters<AgentToolDefinition['execute']>[1]

function tools(): AgentToolDefinition[] {
  return createDashboardBuilderCapabilities(getDeps).tools
}

function tool(name: string): AgentToolDefinition {
  const found = tools().find((t) => t.name === name)
  if (!found) throw new Error(`tool ${name} not registered`)
  return found
}

/** Minimal shape-valid args so success-path cases get past arg validation. */
const VALID_ARGS: Record<string, Record<string, unknown>> = {
  list_widget_kinds: {},
  describe_widget_kind: { kind: 'kpi' },
  list_dashboard_sources: {},
  get_dashboard: {},
  get_widget: { widget: 'Open tickets' },
  preview_widget: { widget: 'Open tickets' },
  validate_dashboard: {},
  add_widget: { kind: 'kpi', title: 'Open tickets' },
  update_widget: { widget: 'Open tickets', title: 'Renamed' },
  change_widget_type: { widget: 'Open tickets', toKind: 'gauge' },
  arrange_widgets: { placements: [{ widget: 'Open tickets', column: 0, row: 0 }] },
  delete_widgets: { widgets: ['Open tickets'] },
  add_tab: { title: 'Second' },
  update_tab: { tab: 'Overview', title: 'Renamed' },
  delete_tab: { tab: 'Overview' },
  set_global_filters: { dateRange: 'allTime' },
  replace_layout: { tabs: [{ title: 'Overview', widgets: [] }] },
}

function run(t: AgentToolDefinition, args: Record<string, unknown> = {}): Promise<AgentToolResult> {
  return t.execute(args as never, agentDeps) as Promise<AgentToolResult>
}

const MUTATION_TOOLS = [
  'add_widget',
  'update_widget',
  'change_widget_type',
  'arrange_widgets',
  'delete_widgets',
  'add_tab',
  'update_tab',
  'delete_tab',
  'set_global_filters',
  'replace_layout',
] as const

const VIEW_TOOLS = [
  'list_widget_kinds',
  'describe_widget_kind',
  'list_dashboard_sources',
  'get_dashboard',
  'get_widget',
  'preview_widget',
  'validate_dashboard',
] as const

const ALL_TOOLS = [...VIEW_TOOLS, ...MUTATION_TOOLS] as const

beforeEach(() => {
  caps = makeCaps()
  refs = [{ kind: 'dashboard', id: DASH }]
  dashboardRows = [{ id: DASH }]
  opMock.mockClear()
  changeTypeMock.mockClear()
  loadDraftContext.mockClear()
  beginDashboardTurnLock.mockClear()
  runAggregate.mockClear()
  runKpi.mockClear()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('dashboard.builder tool registry', () => {
  it('registers exactly the specced 17 tools - no publish/create/delete/share', () => {
    const names = tools().map((t) => t.name)
    expect(names.sort()).toEqual([...ALL_TOOLS].sort())
    expect(names).toHaveLength(17)
    for (const forbidden of [
      'create_dashboard',
      'publish_dashboard',
      'discard_draft',
      'restore_version',
      'delete_dashboard',
      'archive_dashboard',
      'duplicate_dashboard',
      'share_dashboard',
      'set_default_dashboard',
    ]) {
      expect(names).not.toContain(forbidden)
    }
  })

  // The `toolsetSlug` assertion is the inverse of the obvious one on purpose:
  // master Kopilot's toolsets default to the glob `auxx:*`, which cannot match a
  // slug outside that namespace, so a slug here would have `filterToolsByToolsets`
  // silently strip every tool after registration while the prompt still rendered.
  it('every tool is builder-surface only, mounts by page, and declares an enforced permission', () => {
    for (const t of tools()) {
      expect(t.surfaces, t.name).toEqual(['builder'])
      expect(t.toolsetSlug, t.name).toBeUndefined()
      expect(t.permission, t.name).toMatchObject({
        target: 'instance',
        keys: ['dashboard'],
        enforcement: 'enforced',
      })
    }
  })

  it('no tool requires approval - the turn snapshot is the recovery path', () => {
    for (const t of tools()) expect(t.requiresApproval, t.name).toBeUndefined()
  })
})

describe('dashboard.builder authorization enumeration', () => {
  it('every tool refuses without a dashboard ref (bad context, not a throw)', async () => {
    refs = []
    for (const name of ALL_TOOLS) {
      const result = await run(tool(name), VALID_ARGS[name])
      expect(result.success, name).toBe(false)
      expect(result.error, name).toBe(NO_DASHBOARD_REF_ERROR)
    }
    expect(opMock).not.toHaveBeenCalled()
  })

  it('FAIL CLOSED: every tool throws ForbiddenError when capabilities are absent', async () => {
    caps = undefined
    for (const name of ALL_TOOLS) {
      await expect(run(tool(name), VALID_ARGS[name]), name).rejects.toThrow(ForbiddenError)
    }
    expect(opMock).not.toHaveBeenCalled()
  })

  it('every tool throws ForbiddenError without the dashboards area rung', async () => {
    caps?.can.mockReturnValue(false)
    for (const name of ALL_TOOLS) {
      await expect(run(tool(name), VALID_ARGS[name]), name).rejects.toThrow(ForbiddenError)
    }
    expect(opMock).not.toHaveBeenCalled()
  })

  it('a crafted foreign-org ref reads as "not in this workspace" - silent for reads, thrown for writes', async () => {
    dashboardRows = [] // the org-scoped select finds nothing
    for (const name of VIEW_TOOLS) {
      const result = await run(tool(name), VALID_ARGS[name])
      expect(result.success, name).toBe(false)
      expect(result.error, name).toBe(DASHBOARD_NOT_FOUND_ERROR)
    }
    for (const name of MUTATION_TOOLS) {
      await expect(run(tool(name), VALID_ARGS[name]), name).rejects.toThrow(ForbiddenError)
    }
    expect(opMock).not.toHaveBeenCalled()
  })

  // The scope query filters `archivedAt IS NULL`, so an archived dashboard is
  // indistinguishable from a foreign one at this rung. There is no dashboard
  // analogue of `assertWorkflowAppNotSystemOwned`, so that rung does not exist.
  it('an archived dashboard reads as not-found (same select, archivedAt IS NULL)', async () => {
    dashboardRows = []
    const result = await run(tool('get_dashboard'))
    expect(result.success).toBe(false)
    expect(result.error).toBe(DASHBOARD_NOT_FOUND_ERROR)
  })

  it('per-dashboard instance rung: reads filter silently, writes throw', async () => {
    caps?.canViewInstance.mockReturnValue(false)
    const read = await run(tool('get_dashboard'))
    expect(read.success).toBe(false)
    expect(read.error).toBe(DASHBOARD_NOT_FOUND_ERROR)
    expect(caps?.canViewInstance).toHaveBeenCalledWith('dashboard', DASH)

    caps?.assertEditInstance.mockImplementation(() => {
      throw new ForbiddenError('nope')
    })
    await expect(run(tool('add_widget'), VALID_ARGS.add_widget)).rejects.toThrow(ForbiddenError)
    expect(caps?.assertEditInstance).toHaveBeenCalledWith('dashboard', DASH)
  })
})

describe('dirty gate', () => {
  it('every mutation refuses while the chip reports unsaved canvas changes', async () => {
    refs = [{ kind: 'dashboard', id: DASH, isDirty: true }]
    for (const name of MUTATION_TOOLS) {
      const result = await run(tool(name), VALID_ARGS[name])
      expect(result.success, name).toBe(false)
      expect(result.error, name).toBe(DIRTY_CANVAS_ERROR)
    }
    expect(opMock).not.toHaveBeenCalled()
  })

  it('reads still work while dirty', async () => {
    refs = [{ kind: 'dashboard', id: DASH, isDirty: true }]
    for (const name of VIEW_TOOLS) {
      expect((await run(tool(name), VALID_ARGS[name])).success, name).toBe(true)
    }
  })

  it('tolerates the flag being absent - mutations proceed', async () => {
    const result = await run(tool('add_widget'), VALID_ARGS.add_widget)
    expect(result.success).toBe(true)
    expect(opMock).toHaveBeenCalledTimes(1)
  })

  // The gate must be the LAST rung, so a permission denial is never masked by
  // it: a member who lacks edit access on a dirty canvas must still be told
  // (auditably) that they lack access.
  it('a permission denial wins over the dirty gate', async () => {
    refs = [{ kind: 'dashboard', id: DASH, isDirty: true }]
    caps?.assertEditInstance.mockImplementation(() => {
      throw new ForbiddenError('nope')
    })
    await expect(run(tool('add_widget'), VALID_ARGS.add_widget)).rejects.toThrow(ForbiddenError)
  })
})

describe('canvas turn lock', () => {
  it('is claimed on READ tools too, not just mutations', async () => {
    // Locking only on the first mutation would leave the window this closes:
    // the dirty gate reads `isDirty` off the ref captured at message SEND, so a
    // user who dirties the canvas mid-turn is invisible to it. On a dashboard
    // the lock also suspends the 800ms auto-save.
    await run(tool('get_dashboard'))
    expect(beginDashboardTurnLock).toHaveBeenCalledWith(ORG, DASH, 'turn-1')
  })

  it('is claimed on mutations', async () => {
    await run(tool('add_widget'), VALID_ARGS.add_widget)
    expect(beginDashboardTurnLock).toHaveBeenCalledWith(ORG, DASH, 'turn-1')
  })

  // An unauthorized caller must never be able to move the lock: that would let
  // any authenticated member freeze another member's canvas (and suspend their
  // auto-save) by POSTing a crafted dashboard ref at the stream route.
  it('is NOT claimed when authorization fails', async () => {
    caps?.can.mockReturnValue(false)
    await expect(run(tool('add_widget'), VALID_ARGS.add_widget)).rejects.toThrow(ForbiddenError)
    expect(beginDashboardTurnLock).not.toHaveBeenCalled()
  })

  it('is NOT claimed without a dashboard ref', async () => {
    refs = []
    await run(tool('get_dashboard'))
    expect(beginDashboardTurnLock).not.toHaveBeenCalled()
  })
})

describe('turn scoping', () => {
  it('a mutation without a turnId is refused - no snapshot means no Undo', async () => {
    const noTurn = { ...agentDeps, turnId: undefined } as typeof agentDeps
    for (const name of MUTATION_TOOLS) {
      const result = (await tool(name).execute(
        VALID_ARGS[name] as never,
        noTurn
      )) as AgentToolResult
      expect(result.success, name).toBe(false)
      expect(result.error, name).toMatch(/turnId/)
    }
    expect(opMock).not.toHaveBeenCalled()
  })
})
