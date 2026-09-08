// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/__tests__/tools.test.ts
//
// What the guard test does not cover: argument validation, the friendly-input
// projection (names in, ids never out), the two discovery projections, and the
// publish-vs-render split `validate_dashboard` exists to keep straight.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutMutationResult } from '../../../../../../dashboards/draft-edit'
import { BadRequestError } from '../../../../../../errors'
import type { AgentToolDefinition, AgentToolResult } from '../../../../../agent-framework/types'
import type { GetToolDeps, ToolDeps } from '../../../types'

const APPLIED: LayoutMutationResult = {
  applied: true,
  widget: {
    ref: 'Open tickets',
    id: 'w-1',
    tab: 'Overview',
    kind: 'kpi',
    config: '{}',
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

const addWidget = vi.fn(async (..._a: unknown[]) => ok(APPLIED))
const updateWidget = vi.fn(async (..._a: unknown[]) => ok(APPLIED))
const setGlobalFilters = vi.fn(async (..._a: unknown[]) => ok(APPLIED))

const WIDGET = {
  id: 'w-1',
  title: 'Open tickets',
  type: 'recordList',
  gridPosition: { column: 0, row: 0, columnSpan: 6, rowSpan: 5 },
  configuration: {
    kind: 'recordList',
    source: { kind: 'entity', entityDefinitionId: 'def-1' },
    columns: ['def-1:f-subject'],
    sort: { fieldRef: 'def-1:f-created', desc: true },
    filters: [
      {
        id: 'g1',
        logicalOperator: 'AND',
        conditions: [{ id: 'c1', fieldId: 'def-1:f-status', operator: 'is', value: 'OPEN' }],
      },
    ],
    pageSize: 10,
  },
}
const TAB = { id: 'tab-1', title: 'Overview', icon: null, widgets: [WIDGET] }
const DOC = { tabs: [TAB] }

let validation = { issues: [] as unknown[], publishable: true }
let renderIssues: unknown[] = []

vi.mock('../../../../../../dashboards/draft-edit', () => ({
  addWidget: (...a: unknown[]) => addWidget(...a),
  updateWidget: (...a: unknown[]) => updateWidget(...a),
  changeWidgetType: async () => ok({ ...APPLIED, droppedFieldsOnConvert: ['Group by'] }),
  arrangeWidgets: async () => ok(APPLIED),
  deleteWidgets: async () => ok(APPLIED),
  addTab: async () => ok(APPLIED),
  updateTab: async () => ok(APPLIED),
  deleteTab: async () => ok(APPLIED),
  setGlobalFilters: (...a: unknown[]) => setGlobalFilters(...a),
  replaceLayout: async () => ok(APPLIED),
  loadDraftContext: async () =>
    ok({
      row: { name: 'Support', description: null, hasUnpublishedChanges: true },
      doc: DOC,
      layoutHash: 'h',
      entityDefinitionId: null,
    }),
  buildLayoutSummary: () => APPLIED.layoutSummary,
  buildWidgetSummary: () => APPLIED.widget,
  validateDashboard: () => validation,
  widgetIssues: () => renderIssues,
  formatWidgetRef: () => 'Open tickets',
  resolveWidgetRef: (_doc: unknown, ref: string) =>
    ref === 'Open tickets'
      ? ok({ widget: WIDGET, tab: TAB })
      : err(new BadRequestError(`No widget matches "${ref}".`)),
  resolveWidgetSource: async () => ok({ kind: 'entity', entityDefinitionId: 'def-1' }),
  describeSourceForOrg: async () => 'Ticket',
  describeFieldRef: (ref: unknown) =>
    ({
      'def-1:f-subject': 'Subject',
      'def-1:f-created': 'Created at',
      'def-1:f-status': 'Status',
    })[String(ref)] ?? String(ref),
  loadSourceFields: async () => [],
  resolveFieldRef: async () => ok('def-1:f-status'),
  normalizeFilters: async () => ok([]),
}))

vi.mock('../../../../../../dashboards/draft-edit/turn-lock', () => ({
  beginDashboardTurnLock: vi.fn(async () => {}),
}))

vi.mock('../../../../../../cache', () => ({
  getCachedResources: async () => [
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
      id: 'def-2',
      entityDefinitionId: 'def-2',
      apiSlug: 'secrets',
      label: 'Secret',
      plural: 'Secrets',
      entityType: 'secret',
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
    {
      id: 'message',
      entityDefinitionId: 'message',
      apiSlug: 'messages',
      label: 'Message',
      plural: 'Messages',
      entityType: 'message',
      isVisible: true,
      fields: [],
    },
  ],
}))

const runAggregate = vi.fn(async (..._a: unknown[]) =>
  ok({
    groups: Array.from({ length: 25 }, (_unused, index) => ({
      key: `k${index}`,
      label: `Label ${index}`,
      value: index,
    })),
    totalValue: 300,
    hasMoreGroups: false,
  })
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

const ORG = 'org-1'
const DASH = 'dash-1'

const canViewEntity = vi.fn((_defId: string) => true)
const caps = {
  can: () => true,
  canViewEntity: (defId: string) => canViewEntity(defId),
  canViewInstance: () => true,
  assertEditInstance: () => {},
  assertAdminInstance: () => {},
}

const getDeps: GetToolDeps = () =>
  ({
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: DASH }] }) }) }),
    },
    sessionContext: {
      page: 'dashboard.builder',
      references: [{ kind: 'dashboard', id: DASH }],
    },
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

function tool(name: string): AgentToolDefinition {
  const found = createDashboardBuilderCapabilities(getDeps).tools.find((t) => t.name === name)
  if (!found) throw new Error(`tool ${name} not registered`)
  return found
}

function run(name: string, args: Record<string, unknown> = {}): Promise<AgentToolResult> {
  return tool(name).execute(args as never, agentDeps) as Promise<AgentToolResult>
}

beforeEach(() => {
  validation = { issues: [], publishable: true }
  renderIssues = []
  canViewEntity.mockReturnValue(true)
  addWidget.mockClear()
  updateWidget.mockClear()
  setGlobalFilters.mockClear()
  runAggregate.mockClear()
  runKpi.mockClear()
})

describe('discovery projections', () => {
  it('list_widget_kinds projects every kind in WIDGET_KINDS, with whether it reads data', async () => {
    const result = await run('list_widget_kinds')
    const kinds = (result.output as { kinds: Array<{ kind: string; needsSource: boolean }> }).kinds
    expect(kinds.map((k) => k.kind)).toEqual([
      'barChart',
      'lineChart',
      'pieChart',
      'kpi',
      'gauge',
      'recordList',
      'richText',
      'iframe',
    ])
    expect(kinds.find((k) => k.kind === 'kpi')?.needsSource).toBe(true)
    expect(kinds.find((k) => k.kind === 'richText')?.needsSource).toBe(false)
  })

  // The whole point of projecting the zod schemas: these answers come from
  // `config-schemas.ts`, so a ninth kind (or a changed requirement) needs no
  // Kopilot edit at all.
  it('describe_widget_kind derives requiredToPublish from the STRICT publish schema', async () => {
    const gauge = (await run('describe_widget_kind', { kind: 'gauge' })).output as {
      requiredToPublish: string[]
    }
    expect(gauge.requiredToPublish).toEqual(
      expect.arrayContaining(['source', 'metric', 'options.rangeMax'])
    )

    const bar = (await run('describe_widget_kind', { kind: 'barChart' })).output as {
      requiredToPublish: string[]
    }
    expect(bar.requiredToPublish).toEqual(expect.arrayContaining(['source', 'metric', 'groupBy']))

    const kpi = (await run('describe_widget_kind', { kind: 'kpi' })).output as {
      requiredToPublish: string[]
    }
    expect(kpi.requiredToPublish).not.toContain('groupBy')
  })

  // The nuance `validate_dashboard` also has to keep straight: the publish
  // schema has `url: z.string().url().nullable()` and `columns` with no
  // `.min(1)`, so an embed with no URL publishes cleanly and simply renders
  // nothing. Calling that "required to publish" would make the model refuse to
  // finish work that was already finishable.
  it('describe_widget_kind keeps "cannot publish" and "renders nothing" apart', async () => {
    const iframe = (await run('describe_widget_kind', { kind: 'iframe' })).output as {
      requiredToPublish: string[]
      requiredToRender: string[]
    }
    expect(iframe.requiredToPublish).toEqual([])
    expect(iframe.requiredToRender).toEqual([expect.stringContaining('no URL to embed')])
  })

  it('describe_widget_kind names friendly keys, never stored ref keys', async () => {
    const recordList = (await run('describe_widget_kind', { kind: 'recordList' })).output as {
      config: Array<{ key: string }>
      options: Array<{ key: string }>
    }
    const keys = recordList.config.map((entry) => entry.key)
    expect(keys).toContain('columns')
    expect(keys).toContain('globalDateField')
    expect(keys).not.toContain('globalDateFieldRef')
    expect(recordList.options.map((entry) => entry.key)).toContain('pageSize')
  })

  it('describe_widget_kind refuses an unknown kind and names the real ones', async () => {
    const result = await run('describe_widget_kind', { kind: 'sankey' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Unknown widget kind "sankey"/)
    expect(result.error).toMatch(/barChart/)
  })

  it('list_dashboard_sources excludes mail tables and adds the system aggregate tables', async () => {
    const result = await run('list_dashboard_sources')
    const names = (result.output as { sources: Array<{ name: string }> }).sources.map((s) => s.name)
    expect(names).toContain('tickets')
    expect(names).toContain('article')
    // `resolveWidgetSource` refuses both outright, so offering them would offer
    // a source that can only ever 403.
    expect(names).not.toContain('threads')
    expect(names).not.toContain('messages')
  })

  it('list_dashboard_sources filters defs through canViewEntity', async () => {
    canViewEntity.mockImplementation((defId: string) => defId !== 'def-2')
    const result = await run('list_dashboard_sources')
    const names = (result.output as { sources: Array<{ name: string }> }).sources.map((s) => s.name)
    expect(names).toContain('tickets')
    expect(names).not.toContain('secrets')
  })
})

describe('friendly input and output', () => {
  it('add_widget passes names straight through - nothing here resolves an id', async () => {
    await run('add_widget', {
      kind: 'kpi',
      title: 'Open tickets',
      source: 'tickets',
      metric: { op: 'count' },
      filters: [{ field: 'Priority', operator: 'is', value: 'High' }],
    })
    const input = addWidget.mock.calls[0]?.[2] as Record<string, unknown>
    expect(input).toMatchObject({ kind: 'kpi', title: 'Open tickets', source: 'tickets' })
    expect(input.metric).toEqual({ op: 'count' })
    const groups = input.filters as Array<{ conditions: Array<Record<string, unknown>> }>
    expect(groups[0]?.conditions[0]).toMatchObject({
      fieldId: 'Priority',
      operator: 'is',
      value: 'High',
    })
  })

  it('filterMatch: "any" becomes an OR group', async () => {
    await run('add_widget', {
      kind: 'kpi',
      source: 'tickets',
      filters: [
        { field: 'Status', operator: 'is', value: 'Open' },
        { field: 'Status', operator: 'is', value: 'Pending' },
      ],
      filterMatch: 'any',
    })
    const input = addWidget.mock.calls[0]?.[2] as { filters: Array<{ logicalOperator: string }> }
    expect(input.filters[0]?.logicalOperator).toBe('OR')
  })

  it('add_widget refuses an unknown kind before touching the draft', async () => {
    const result = await run('add_widget', { kind: 'sankey' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/must be one of/)
    expect(addWidget).not.toHaveBeenCalled()
  })

  it('update_widget requires a widget ref', async () => {
    const result = await run('update_widget', { title: 'x' })
    expect(result.success).toBe(false)
    expect(result.error).toBe('widget is required.')
    expect(updateWidget).not.toHaveBeenCalled()
  })

  it('an unresolvable widget ref comes back with the resolver message, not a throw', async () => {
    const result = await run('get_widget', { widget: 'Nope' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/No widget matches "Nope"/)
  })

  // The render-back half of the normalization contract: a model that has never
  // seen a raw id cannot invent one.
  it('get_widget renders the config with NAMES - no branded refs leave the capability', async () => {
    const result = await run('get_widget', { widget: 'Open tickets' })
    const config = (result.output as { config: Record<string, unknown> }).config
    expect(config.source).toBe('Ticket')
    expect(config.columns).toEqual(['Subject'])
    expect(config.sort).toEqual({ field: 'Created at', desc: true })
    expect(config.filters).toEqual([
      { match: 'all', conditions: [{ field: 'Status', operator: 'is', value: 'OPEN' }] },
    ])
    expect(JSON.stringify(config)).not.toContain('def-1:')
  })

  it('change_widget_type reports what the conversion dropped', async () => {
    const result = await run('change_widget_type', { widget: 'Open tickets', toKind: 'kpi' })
    expect(result.success).toBe(true)
    expect((result.output as { droppedFieldsOnConvert: string[] }).droppedFieldsOnConvert).toEqual([
      'Group by',
    ])
  })

  it('arrange_widgets is the only tool that takes coordinates, and it validates them', async () => {
    const result = await run('arrange_widgets', { placements: [{ widget: 'x' }] })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/placements is required/)
  })

  it('set_global_filters refuses a call that would set nothing', async () => {
    const result = await run('set_global_filters', {})
    expect(result.success).toBe(false)
    expect(setGlobalFilters).not.toHaveBeenCalled()
  })

  it('set_global_filters shapes its per-source conditions', async () => {
    await run('set_global_filters', {
      filters: [
        { source: 'tickets', filters: [{ field: 'Status', operator: 'is', value: 'Open' }] },
      ],
    })
    const input = setGlobalFilters.mock.calls[0]?.[2] as {
      conditions: Array<{ source: string; groups: Array<{ conditions: unknown[] }> }>
    }
    expect(input.conditions[0]?.source).toBe('tickets')
    expect(input.conditions[0]?.groups[0]?.conditions).toHaveLength(1)
  })
})

describe('preview_widget', () => {
  it('threads capabilities into the aggregate call', async () => {
    // Not optional plumbing: `article` is the one aggregate source with a
    // per-row policy, and `capabilities: undefined` means UNRESTRICTED.
    await run('preview_widget', {
      kind: 'barChart',
      source: 'tickets',
      groupBy: { field: 'Status' },
    })
    expect(runAggregate).toHaveBeenCalledTimes(1)
    expect(runAggregate.mock.calls[0]?.[4]).toMatchObject({ capabilities: caps })
  })

  it('caps the rows it returns and says how many are left', async () => {
    const result = await run('preview_widget', {
      kind: 'barChart',
      source: 'tickets',
      groupBy: { field: 'Status' },
    })
    const output = result.output as { rows: unknown[]; rowCount: number; moreRows?: number }
    expect(output.rowCount).toBe(25)
    expect(output.rows).toHaveLength(20)
    expect(output.moreRows).toBe(5)
  })

  it('runs the KPI path for a saved kpi/gauge widget', async () => {
    const result = await run('preview_widget', { kind: 'kpi', source: 'tickets' })
    expect(runKpi).toHaveBeenCalledTimes(1)
    expect(runKpi.mock.calls[0]?.[4]).toMatchObject({ capabilities: caps })
    expect((result.output as { value: number }).value).toBe(7)
  })

  it('refuses a widget kind that runs no query', async () => {
    const result = await run('preview_widget', { widget: 'Open tickets' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Record lists, notes and embeds/)
  })

  it('needs either a saved widget or an inline kind', async () => {
    const result = await run('preview_widget', {})
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/either `widget`/)
  })
})

describe('validate_dashboard', () => {
  // The failure this split exists to prevent: `validateDashboard` returns
  // error-severity issues that do NOT block publishing (an embed with no URL, a
  // record list with no columns), so a caller that counts errors refuses to
  // finish work that was already finishable.
  it('separates "blocks publish" from "will render empty"', async () => {
    const renderIssue = {
      severity: 'error' as const,
      message: 'Record list "Open tickets" shows no columns.',
      widgetRef: 'Open tickets',
    }
    renderIssues = [renderIssue]
    validation = { issues: [renderIssue], publishable: true }

    const result = await run('validate_dashboard')
    const output = result.output as {
      publishable: boolean
      blocksPublish: unknown[]
      willRenderEmpty: unknown[]
    }
    expect(output.publishable).toBe(true)
    expect(output.blocksPublish).toEqual([])
    expect(output.willRenderEmpty).toEqual([renderIssue])
  })

  it('a schema complaint DOES block publish', async () => {
    const schemaIssue = {
      severity: 'error' as const,
      message: 'tabs.0.widgets.0.rangeMax: Invalid input: expected number, received undefined',
      widgetRef: 'Open tickets',
    }
    renderIssues = []
    validation = { issues: [schemaIssue], publishable: false }

    const result = await run('validate_dashboard')
    const output = result.output as { publishable: boolean; blocksPublish: unknown[] }
    expect(output.publishable).toBe(false)
    expect(output.blocksPublish).toEqual([schemaIssue])
  })
})

describe('get_dashboard', () => {
  it('reports whether the draft has diverged from what is published', async () => {
    const result = await run('get_dashboard')
    expect(result.success).toBe(true)
    expect((result.output as { hasUnpublishedChanges: boolean }).hasUnpublishedChanges).toBe(true)
  })
})
