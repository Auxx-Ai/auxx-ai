// packages/lib/src/dashboards/draft-edit/__tests__/ops.test.ts
//
// The mutation pipeline, asserted as PROPERTIES rather than implementations,
// because the implementations are `layout-ops`' and are already tested there:
//
// - a structural refusal does not persist, and says what blocked it;
// - a config-level problem DOES persist and comes back as an issue, because a
//   half-built dashboard is what the canvas looks like whenever a human adds a
//   widget and then picks its source;
// - an edit that changed nothing reports `unchanged` instead of a phantom edit;
// - the last tab cannot be deleted (the strict schema needs `tabs.min(1)`, so
//   allowing it would write a draft that can never be published);
// - `replaceLayout` refuses over configured widgets;
// - the CAS token loaded with the draft is threaded into the write.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fieldsFor, RESOURCES } from './support/org-fixtures'

vi.mock('../../../cache', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getCachedResources: async () => RESOURCES,
    getCachedResourceFields: async (_org: string, id: string) => fieldsFor(id),
  }
})

const redisStore = new Map<string, unknown>()
vi.mock('@auxx/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/redis')>()),
  getRedisData: vi.fn(async (key: string) => redisStore.get(key) ?? null),
  setRedisData: vi.fn(async (key: string, data: unknown) => {
    redisStore.set(key, data)
    return 'OK'
  }),
  deleteRedisData: vi.fn(async (key: string) => (redisStore.delete(key) ? 1 : 0)),
}))

import type { DashboardLayoutDoc, WidgetConfiguration } from '../../client'
import { hashLayoutDoc } from '../../config-hash'
import {
  addTab,
  addWidget,
  arrangeWidgets,
  changeWidgetType,
  deleteTab,
  deleteWidgets,
  replaceLayout,
  setGlobalFilters,
  updateTab,
  updateWidget,
} from '../ops'
import { doc, makeDb, tab, widget } from './support/fixtures'

const SCOPE = { dashboardId: 'dash_1', organizationId: 'org_1' }

/** A bar chart over Ticket, fully configured against the fixture org. */
function ticketChart(): WidgetConfiguration {
  return {
    kind: 'barChart',
    source: { kind: 'entity', entityDefinitionId: 'ticket' },
    metric: { op: 'count' },
    groupBy: { fieldRef: 'ticket:fld_status' },
  } as unknown as WidgetConfiguration
}

const starter = () => doc([tab('tab_1', 'Overview', [])])

beforeEach(() => {
  redisStore.clear()
})

describe('addWidget', () => {
  it('places a widget with friendly source, metric and group-by resolved', async () => {
    const { db, row } = makeDb({ draftLayout: starter() })
    const result = await addWidget(db, SCOPE, {
      kind: 'barChart',
      title: 'Tickets by status',
      source: 'Tickets',
      metric: { op: 'count' },
      groupBy: { field: 'Status' },
    })

    const value = result._unsafeUnwrap()
    expect(value.applied).toBe(true)
    expect(value.widget?.ref).toBe('Tickets by status')
    const stored = row.draftLayout as DashboardLayoutDoc
    const added = stored.tabs[0]?.widgets[0]
    expect(added?.configuration).toMatchObject({
      source: { kind: 'entity', entityDefinitionId: 'ticket' },
      groupBy: { fieldRef: 'ticket:fld_status' },
    })
    // Placement is automatic; the caller never sends coordinates.
    expect(added?.gridPosition).toBeDefined()
  })

  // The config split: unconfigured is a legitimate draft state.
  it('PERSISTS an unconfigured widget and reports it as an issue', async () => {
    const { db, row } = makeDb({ draftLayout: starter() })
    const result = await addWidget(db, SCOPE, { kind: 'barChart', title: 'Empty' })
    const value = result._unsafeUnwrap()

    expect(value.applied).toBe(true)
    expect((row.draftLayout as DashboardLayoutDoc).tabs[0]?.widgets).toHaveLength(1)
    expect(value.issues.some((i) => i.widgetRef === 'Empty' && i.severity === 'error')).toBe(true)
    expect(value.layoutSummary.unconfiguredCount).toBe(1)
  })

  // The structural split: an unresolvable name is refused, and nothing is written.
  it('REFUSES an unknown source without persisting', async () => {
    const { db, row, updates } = makeDb({ draftLayout: starter() })
    const before = row.draftLayout
    const result = await addWidget(db, SCOPE, { kind: 'kpi', source: 'tickts' })
    const value = result._unsafeUnwrap()

    expect(value.applied).toBe(false)
    expect(value.blockedBy?.[0]?.message).toContain('Unknown dashboard source')
    expect(row.draftLayout).toBe(before)
    expect(updates).toHaveLength(0)
  })

  it('REFUSES an unknown field, naming the closest matches', async () => {
    const { db, updates } = makeDb({ draftLayout: starter() })
    const result = await addWidget(db, SCOPE, {
      kind: 'barChart',
      source: 'Tickets',
      groupBy: { field: 'statuss' },
    })
    expect(result._unsafeUnwrap().blockedBy?.[0]?.message).toContain('No field "statuss"')
    expect(updates).toHaveLength(0)
  })

  it('REFUSES a mail source with the reason spelled out', async () => {
    const { db, updates } = makeDb({ draftLayout: starter() })
    const result = await addWidget(db, SCOPE, { kind: 'kpi', source: 'threads' })
    expect(result._unsafeUnwrap().blockedBy?.[0]?.message).toMatch(/mailbox/i)
    expect(updates).toHaveLength(0)
  })

  it('REFUSES a filter that would be silently dropped', async () => {
    const { db, updates } = makeDb({ draftLayout: starter() })
    const result = await addWidget(db, SCOPE, {
      kind: 'kpi',
      source: 'Tickets',
      filters: [
        {
          id: 'grp',
          logicalOperator: 'AND',
          conditions: [{ id: 'c1', fieldId: 'Status', operator: 'starts with', value: 'ACTIVE' }],
        } as never,
      ],
    })
    expect(result._unsafeUnwrap().blockedBy?.[0]?.message).toMatch(/unfiltered data/i)
    expect(updates).toHaveLength(0)
  })

  it('de-duplicates a title across the whole doc, so a ref stays unambiguous', async () => {
    const { db, row } = makeDb({
      draftLayout: doc([tab('tab_1', 'One', [widget('w1', 'Notes')]), tab('tab_2', 'Two', [])]),
    })
    await addWidget(db, SCOPE, { kind: 'richText', tab: 'Two', title: 'Notes' })
    const titles = (row.draftLayout as DashboardLayoutDoc).tabs.flatMap((t) =>
      t.widgets.map((w) => w.title)
    )
    expect(titles).toEqual(['Notes', 'Notes 2'])
  })
})

describe('updateWidget', () => {
  it('shallow-merges: setting a group-by does not clear the metric', async () => {
    const config = {
      kind: 'barChart',
      source: { kind: 'entity', entityDefinitionId: 'ticket' },
      metric: { op: 'countUnique', fieldRef: 'ticket:fld_subject' },
    } as unknown as WidgetConfiguration
    const { db, row } = makeDb({
      draftLayout: doc([tab('tab_1', 'Overview', [widget('w1', 'Chart', config)])]),
    })

    const result = await updateWidget(db, SCOPE, {
      widget: 'Chart',
      groupBy: { field: 'Status' },
    })
    expect(result._unsafeUnwrap().applied).toBe(true)
    expect(
      (row.draftLayout as DashboardLayoutDoc).tabs[0]?.widgets[0]?.configuration
    ).toMatchObject({
      metric: { op: 'countUnique', fieldRef: 'ticket:fld_subject' },
      groupBy: { fieldRef: 'ticket:fld_status' },
    })
  })

  it('refuses a kind inside options: that is what changeWidgetType is for', async () => {
    const { db, updates } = makeDb({
      draftLayout: doc([tab('tab_1', 'Overview', [widget('w1', 'Chart', ticketChart())])]),
    })
    const result = await updateWidget(db, SCOPE, {
      widget: 'Chart',
      options: { kind: 'kpi' },
    })
    expect(result._unsafeUnwrap().blockedBy?.[0]?.message).toContain('changeWidgetType')
    expect(updates).toHaveLength(0)
  })

  it('refuses a raw field ref smuggled through options', async () => {
    const { db, updates } = makeDb({
      draftLayout: doc([tab('tab_1', 'Overview', [widget('w1', 'Chart', ticketChart())])]),
    })
    const result = await updateWidget(db, SCOPE, {
      widget: 'Chart',
      options: { groupBy: { fieldRef: 'contact:fld_email' } },
    })
    expect(result._unsafeUnwrap().applied).toBe(false)
    expect(updates).toHaveLength(0)
  })

  // Changing the source leaves refs the doc refinement would reject WHOLESALE.
  it('drops the stale refs when the source changes, and warns about each', async () => {
    const { db, row } = makeDb({
      draftLayout: doc([tab('tab_1', 'Overview', [widget('w1', 'Chart', ticketChart())])]),
    })
    const result = await updateWidget(db, SCOPE, { widget: 'Chart', source: 'Projects' })
    const value = result._unsafeUnwrap()

    expect(value.applied).toBe(true)
    const config = (row.draftLayout as DashboardLayoutDoc).tabs[0]?.widgets[0]
      ?.configuration as Record<string, unknown>
    expect(config.source).toEqual({ kind: 'entity', entityDefinitionId: 'cust_def_1' })
    expect(config.groupBy).toBeUndefined()
    expect(
      value.issues.some((i) => i.severity === 'warning' && i.message.includes('groupBy'))
    ).toBe(true)
  })

  it('keeps a ref supplied in the SAME call as the source change', async () => {
    const { db, row } = makeDb({
      draftLayout: doc([tab('tab_1', 'Overview', [widget('w1', 'Chart', ticketChart())])]),
    })
    await updateWidget(db, SCOPE, {
      widget: 'Chart',
      source: 'Projects',
      groupBy: { field: 'Name' },
    })
    expect(
      (row.draftLayout as DashboardLayoutDoc).tabs[0]?.widgets[0]?.configuration
    ).toMatchObject({ groupBy: { fieldRef: 'cust_def_1:fld_name' } })
  })

  it('reports `unchanged` rather than writing a phantom edit', async () => {
    const { db, updates } = makeDb({
      draftLayout: doc([tab('tab_1', 'Overview', [widget('w1', 'Chart', ticketChart())])]),
    })
    const result = await updateWidget(db, SCOPE, { widget: 'Chart', title: 'Chart' })
    const value = result._unsafeUnwrap()
    expect(value.applied).toBe(true)
    expect(value.unchanged).toBe(true)
    expect(updates).toHaveLength(0)
  })

  it('REFUSES an unresolvable widget ref, naming the candidates', async () => {
    const { db, updates } = makeDb({
      draftLayout: doc([tab('tab_1', 'Overview', [widget('w1', 'Chart', ticketChart())])]),
    })
    const result = await updateWidget(db, SCOPE, { widget: 'Charrt', title: 'x' })
    expect(result._unsafeUnwrap().applied).toBe(false)
    expect(updates).toHaveLength(0)
  })
})

describe('changeWidgetType', () => {
  it('converts and surfaces what the conversion dropped', async () => {
    const { db, row } = makeDb({
      draftLayout: doc([tab('tab_1', 'Overview', [widget('w1', 'Chart', ticketChart())])]),
    })
    const result = await changeWidgetType(db, SCOPE, { widget: 'Chart', kind: 'kpi' })
    const value = result._unsafeUnwrap()

    expect(value.applied).toBe(true)
    expect(value.droppedFieldsOnConvert).toContain('Category')
    expect((row.draftLayout as DashboardLayoutDoc).tabs[0]?.widgets[0]?.type).toBe('kpi')
  })

  it('refuses converting a rich-text note, which has no data config to carry', async () => {
    const { db, updates } = makeDb({
      draftLayout: doc([tab('tab_1', 'Overview', [widget('w1', 'Note')])]),
    })
    const result = await changeWidgetType(db, SCOPE, { widget: 'Note', kind: 'kpi' })
    expect(result._unsafeUnwrap().applied).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it('is a no-op when the widget is already that kind', async () => {
    const { db, updates } = makeDb({
      draftLayout: doc([tab('tab_1', 'Overview', [widget('w1', 'Chart', ticketChart())])]),
    })
    const result = await changeWidgetType(db, SCOPE, { widget: 'Chart', kind: 'barChart' })
    expect(result._unsafeUnwrap().unchanged).toBe(true)
    expect(updates).toHaveLength(0)
  })
})

describe('arrangeWidgets', () => {
  it('clamps a placement onto the 12-column grid', async () => {
    const { db, row } = makeDb({
      draftLayout: doc([tab('tab_1', 'Overview', [widget('w1', 'Note')])]),
    })
    const result = await arrangeWidgets(db, SCOPE, {
      placements: [{ widget: 'Note', column: 11, row: 3, columnSpan: 6 }],
    })
    expect(result._unsafeUnwrap().applied).toBe(true)
    const position = (row.draftLayout as DashboardLayoutDoc).tabs[0]?.widgets[0]?.gridPosition
    expect(position).toMatchObject({ column: 6, row: 3, columnSpan: 6 })
  })

  it('refuses the WHOLE batch when one widget does not resolve', async () => {
    const { db, updates } = makeDb({
      draftLayout: doc([tab('tab_1', 'Overview', [widget('w1', 'Note')])]),
    })
    const result = await arrangeWidgets(db, SCOPE, {
      placements: [
        { widget: 'Note', column: 0, row: 0 },
        { widget: 'Nope', column: 0, row: 4 },
      ],
    })
    expect(result._unsafeUnwrap().applied).toBe(false)
    expect(updates).toHaveLength(0)
  })
})

describe('deleteWidgets', () => {
  it('removes them and returns the summaries so the caller can name what went', async () => {
    const { db, row } = makeDb({
      draftLayout: doc([
        tab('tab_1', 'Overview', [widget('w1', 'Note'), widget('w2', 'Chart', ticketChart())]),
      ]),
    })
    const result = await deleteWidgets(db, SCOPE, { widgets: ['Note', 'Chart'] })
    const value = result._unsafeUnwrap()

    expect(value.applied).toBe(true)
    expect(value.widgets?.map((w) => w.ref)).toEqual(['Note', 'Chart'])
    expect((row.draftLayout as DashboardLayoutDoc).tabs[0]?.widgets).toHaveLength(0)
  })
})

describe('tabs', () => {
  it('adds and renames', async () => {
    const { db, row } = makeDb({ draftLayout: starter() })
    expect((await addTab(db, SCOPE, { title: 'Revenue' }))._unsafeUnwrap().applied).toBe(true)
    expect(
      (await updateTab(db, SCOPE, { tab: 'Revenue', title: 'Money' }))._unsafeUnwrap().applied
    ).toBe(true)
    expect((row.draftLayout as DashboardLayoutDoc).tabs.map((t) => t.title)).toEqual([
      'Overview',
      'Money',
    ])
  })

  // `tabs.min(1)` on the publish schema: removing the last tab writes a draft
  // that could never be published, so it is refused at the op with a reason.
  it('REFUSES to delete the last tab', async () => {
    const { db, updates } = makeDb({ draftLayout: starter() })
    const result = await deleteTab(db, SCOPE, { tab: 'Overview' })
    const value = result._unsafeUnwrap()

    expect(value.applied).toBe(false)
    expect(value.blockedBy?.[0]?.message).toMatch(/only tab/i)
    expect(updates).toHaveLength(0)
  })

  it('deletes a tab once another one exists', async () => {
    const { db, row } = makeDb({
      draftLayout: doc([tab('tab_1', 'Overview', []), tab('tab_2', 'Extra', [])]),
    })
    expect((await deleteTab(db, SCOPE, { tab: 'Extra' }))._unsafeUnwrap().applied).toBe(true)
    expect((row.draftLayout as DashboardLayoutDoc).tabs).toHaveLength(1)
  })
})

describe('setGlobalFilters', () => {
  it('writes the versioned defaults with resolved refs and option keys', async () => {
    const { db, row } = makeDb({ draftLayout: starter() })
    const result = await setGlobalFilters(db, SCOPE, {
      conditions: [
        {
          source: 'Tickets',
          groups: [
            {
              id: 'grp',
              logicalOperator: 'AND',
              conditions: [{ id: 'c1', fieldId: 'Status', operator: 'is', value: 'Active' }],
            } as never,
          ],
        },
      ],
      dateRange: 'last30d',
    })

    expect(result._unsafeUnwrap().applied).toBe(true)
    const filters = (row.draftLayout as DashboardLayoutDoc).globalFilters
    expect(filters?.dateRange).toBe('last30d')
    expect(filters?.conditions?.[0]?.entityDefinitionId).toBe('ticket')
    expect(filters?.conditions?.[0]?.groups[0]?.conditions[0]).toMatchObject({
      fieldId: 'ticket:fld_status',
      value: 'ACTIVE',
    })
  })
})

describe('replaceLayout', () => {
  it('builds a whole dashboard on an empty draft', async () => {
    const { db, row } = makeDb({ draftLayout: starter() })
    const result = await replaceLayout(db, SCOPE, {
      tabs: [
        {
          title: 'Support',
          widgets: [
            { kind: 'kpi', title: 'Open tickets', source: 'Tickets', metric: { op: 'count' } },
            {
              kind: 'barChart',
              title: 'By status',
              source: 'Tickets',
              metric: { op: 'count' },
              groupBy: { field: 'Status' },
            },
          ],
        },
      ],
    })

    expect(result._unsafeUnwrap().applied).toBe(true)
    const stored = row.draftLayout as DashboardLayoutDoc
    expect(stored.tabs).toHaveLength(1)
    expect(stored.tabs[0]?.widgets.map((w) => w.title)).toEqual(['Open tickets', 'By status'])
  })

  // The silent-deletion hole: a whole-document write drops whatever the caller
  // failed to restate, so it is greenfield-only.
  it('REFUSES once the draft holds a configured widget, and names the tools to use', async () => {
    const { db, row, updates } = makeDb({
      draftLayout: doc([tab('tab_1', 'Overview', [widget('w1', 'Chart', ticketChart())])]),
    })
    const before = row.draftLayout
    const result = await replaceLayout(db, SCOPE, { tabs: [{ title: 'New' }] })
    const value = result._unsafeUnwrap()

    expect(value.applied).toBe(false)
    expect(value.blockedBy?.[0]?.message).toContain('addWidget')
    expect(row.draftLayout).toBe(before)
    expect(updates).toHaveLength(0)
  })

  it('allows a draft holding only untouched placeholder widgets', async () => {
    const { db } = makeDb({
      draftLayout: doc([tab('tab_1', 'Overview', [widget('w1', 'Note')])]),
    })
    const result = await replaceLayout(db, SCOPE, { tabs: [{ title: 'Fresh' }] })
    expect(result._unsafeUnwrap().applied).toBe(true)
  })
})

describe('the CAS token', () => {
  it('threads the loaded layout hash into the write and refuses a stale draft', async () => {
    const before = doc([tab('tab_1', 'Overview', [])])
    const { db } = makeDb({ draftLayout: before })

    // A concurrent save lands between load and write: the write must lose.
    const original = db.query.Dashboard.findFirst
    let firstRead = true
    ;(db.query.Dashboard as { findFirst: unknown }).findFirst = async (...args: unknown[]) => {
      const row = (await (original as (...a: unknown[]) => Promise<Record<string, unknown>>)(
        ...args
      )) as Record<string, unknown>
      if (firstRead) {
        firstRead = false
        return row
      }
      return { ...row, draftLayout: doc([tab('tab_1', 'Overview', [widget('wX', 'Sneaked')])]) }
    }

    const result = await addWidget(db, SCOPE, { kind: 'richText', title: 'Note' })
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toMatch(/changed while this edit was being prepared/i)
  })

  it('captures the pre-turn snapshot on the first write of a turn only', async () => {
    const { db } = makeDb({ draftLayout: starter() })
    const scope = { ...SCOPE, turnId: 'turn_a' }
    await addWidget(db, scope, { kind: 'richText', title: 'One' })
    const captured = redisStore.get('dashboard:layout:dash_1:preturn') as {
      doc: DashboardLayoutDoc
    }
    expect(captured.doc).toEqual(starter())

    await addWidget(db, scope, { kind: 'richText', title: 'Two' })
    // Still the PRE-turn doc: a second write must not bump it, or whole-turn
    // Undo degrades to undo-the-last-edit.
    expect(
      (redisStore.get('dashboard:layout:dash_1:preturn') as { doc: DashboardLayoutDoc }).doc
    ).toEqual(starter())
  })

  it('does not capture anything when a mutation is refused', async () => {
    const { db } = makeDb({ draftLayout: starter() })
    await addWidget(db, { ...SCOPE, turnId: 'turn_b' }, { kind: 'kpi', source: 'nope' })
    expect(redisStore.has('dashboard:layout:dash_1:preturn')).toBe(false)
  })

  it('stamps the post-turn hash after a successful write', async () => {
    const { db, row } = makeDb({ draftLayout: starter() })
    await addWidget(db, { ...SCOPE, turnId: 'turn_c' }, { kind: 'richText', title: 'One' })
    const snapshot = redisStore.get('dashboard:layout:dash_1:preturn') as {
      postTurnLayoutHash?: string
    }
    expect(snapshot.postTurnLayoutHash).toBe(hashLayoutDoc(row.draftLayout as DashboardLayoutDoc))
  })
})
