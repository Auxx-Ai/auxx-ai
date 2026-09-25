// packages/lib/src/seed/entity-seeder/mrp-dashboard-widgets.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toResourceFieldId } from '@auxx/types/field'
import { generateId } from '@auxx/utils'
import { and, eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { getCachedEntityDefId, getCachedResource } from '../../cache'
import type { Condition, ConditionGroup } from '../../conditions/types'
import type {
  DashboardLayoutDoc,
  GridPosition,
  LayoutTab,
  LayoutWidget,
  WidgetConfiguration,
  WidgetKind,
  WidgetSource,
} from '../../dashboards/client'
import { dashboardLayoutDocSchema } from '../../dashboards/config-schemas'
import { insertPublishedDashboard } from '../../dashboards/dashboard-mutations'
import { appendPublishedTab } from '../../dashboards/version-mutations'
import { SystemUserService } from '../../users/system-user-service'

const logger = createScopedLogger('mrp:dashboard-widgets')

const SOURCE_TABLE = 'mrp_plan_item'
const SOURCE: WidgetSource = { kind: 'system', tableId: SOURCE_TABLE }
const PLAN_PATH = '/app/parts/manage/plan'
/** Order-by and stockout charts look this far ahead; the condition builder has no "next N days". */
const LOOKAHEAD_DAYS = 84

const field = (key: string) => toResourceFieldId(SOURCE_TABLE, key)

function cond(key: string, operator: Condition['operator'], value?: unknown): Condition {
  return { id: generateId(), fieldId: field(key), operator, value, isConstant: true }
}

function where(...conditions: Condition[]): ConditionGroup[] {
  return [{ id: generateId(), logicalOperator: 'AND', conditions }]
}

/** `older_than_days` with a negative count is "before N days from now": the lookahead bound. */
const within = (key: string) => [
  cond(key, 'not empty'),
  cond(key, 'older_than_days', -LOOKAHEAD_DAYS),
]

function widget(
  title: string,
  type: WidgetKind,
  gridPosition: GridPosition,
  configuration: WidgetConfiguration
): LayoutWidget {
  return { id: generateId(), title, type, gridPosition, configuration }
}

/** The six Parts dashboard widgets over the plan (plans/mrp/07-ui-plan.md §5.4), fresh ids per call. */
export function buildMrpPlanningTab(): LayoutTab {
  const latest = cond('isLatest', 'is', true)
  return {
    id: generateId(),
    title: 'Planning',
    icon: null,
    widgets: [
      widget(
        'Overdue',
        'kpi',
        { column: 0, row: 0, columnSpan: 3, rowSpan: 2 },
        {
          kind: 'kpi',
          source: SOURCE,
          metric: { op: 'count' },
          globalDateFieldRef: null,
          filters: where(latest, cond('isOverdue', 'is', true)),
          link: `${PLAN_PATH}?tab=overdue`,
        }
      ),
      widget(
        'Order-by per week',
        'barChart',
        { column: 3, row: 0, columnSpan: 9, rowSpan: 4 },
        {
          kind: 'barChart',
          source: SOURCE,
          metric: { op: 'count' },
          groupBy: { fieldRef: field('orderByDate'), dateGranularity: 'week', limit: 13 },
          globalDateFieldRef: null,
          filters: where(latest, cond('isOverdue', 'is', false), ...within('orderByDate')),
          link: PLAN_PATH,
        }
      ),
      widget(
        'Flagged parts',
        'pieChart',
        { column: 0, row: 2, columnSpan: 3, rowSpan: 6 },
        {
          kind: 'pieChart',
          source: SOURCE,
          metric: { op: 'count' },
          groupBy: { fieldRef: field('flags'), omitEmpty: true },
          globalDateFieldRef: null,
          filters: where(latest),
          donut: true,
          link: `${PLAN_PATH}?tab=flagged`,
        }
      ),
      // A bar, not 07's record list: the record lane needs an `id` column MrpPlanRunItem lacks.
      widget(
        'Upcoming stockouts',
        'barChart',
        { column: 3, row: 4, columnSpan: 9, rowSpan: 4 },
        {
          kind: 'barChart',
          source: SOURCE,
          metric: { op: 'count' },
          groupBy: { fieldRef: field('stockoutDate'), dateGranularity: 'week', limit: 13 },
          globalDateFieldRef: null,
          filters: where(latest, ...within('stockoutDate')),
          color: 'red',
          link: PLAN_PATH,
        }
      ),
      widget(
        'Suggested purchases by supplier',
        'barChart',
        { column: 0, row: 8, columnSpan: 6, rowSpan: 4 },
        {
          kind: 'barChart',
          source: SOURCE,
          metric: { op: 'sum', fieldRef: field('suggestedQty') },
          groupBy: { fieldRef: field('suggestedSupplierId'), omitEmpty: true },
          globalDateFieldRef: null,
          filters: where(latest, cond('suggestionKind', 'is', 'purchase')),
          layout: 'horizontal',
          link: `${PLAN_PATH}?suggestionKind=purchase`,
        }
      ),
      widget(
        'Overdue over time',
        'lineChart',
        { column: 6, row: 8, columnSpan: 6, rowSpan: 4 },
        {
          kind: 'lineChart',
          source: SOURCE,
          metric: { op: 'count' },
          groupBy: { fieldRef: field('runAsOf'), dateGranularity: 'day' },
          globalDateFieldRef: field('runAsOf'),
          filters: where(cond('isOverdue', 'is', true)),
          link: `${PLAN_PATH}?tab=overdue`,
        }
      ),
    ],
  }
}

/** Whether any widget in the docs reads the plan source; the seed's idempotence key. */
export function hasMrpPlanWidget(docs: DashboardLayoutDoc[]): boolean {
  return docs.some((doc) =>
    doc.tabs.some((tab) =>
      tab.widgets.some((w) => {
        const source = (w.configuration as { source?: WidgetSource }).source
        return source?.kind === 'system' && source.tableId === SOURCE_TABLE
      })
    )
  )
}

export type MrpDashboardSeedOutcome = 'created_dashboard' | 'added_tab' | 'skipped'

/**
 * Put the planning widgets on the org's Parts dashboard, creating it if the org has none. Skips
 * when any plan widget already exists (so edits and deletes of single widgets stick) or the
 * Parts dashboard was archived.
 */
export async function ensureMrpDashboardWidgets(
  db: Database,
  organizationId: string
): Promise<Result<MrpDashboardSeedOutcome, Error>> {
  const partDefId = await getCachedEntityDefId(organizationId, 'part')
  if (!partDefId) return ok('skipped')

  const [existing] = await db
    .select({ id: schema.Dashboard.id, archivedAt: schema.Dashboard.archivedAt })
    .from(schema.Dashboard)
    .where(
      and(
        eq(schema.Dashboard.organizationId, organizationId),
        eq(schema.Dashboard.entityDefinitionId, partDefId)
      )
    )
    .limit(1)
  if (existing?.archivedAt) return ok('skipped')

  const userId = await SystemUserService.getSystemUserForActions(organizationId)
  const tab = buildMrpPlanningTab()

  if (existing) {
    const appended = await appendPublishedTab(db, organizationId, existing.id, {
      tab,
      editorId: userId,
      label: 'Planning widgets',
      shouldAppend: (docs) => !hasMrpPlanWidget(docs),
    })
    if (appended.isErr()) return err(appended.error)
    if (appended.value)
      logger.info('Added planning widgets to the Parts dashboard', { organizationId })
    return ok(appended.value ? 'added_tab' : 'skipped')
  }

  const layout = dashboardLayoutDocSchema.safeParse({ tabs: [tab] })
  if (!layout.success) return err(new Error(`Invalid planning tab: ${layout.error.message}`))
  const resource = await getCachedResource(organizationId, partDefId)
  await insertPublishedDashboard(db, organizationId, {
    name: `${resource?.plural ?? 'Parts'} Dashboard`,
    icon: resource ? { iconId: resource.icon, color: resource.color } : undefined,
    entityDefinitionId: partDefId,
    createdById: userId,
    layout: layout.data as DashboardLayoutDoc,
  })
  logger.info('Created the Parts dashboard with planning widgets', { organizationId })
  return ok('created_dashboard')
}
