// packages/lib/src/seed/entity-seeder/create-default-dashboards.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { ResourceFieldId } from '@auxx/types/field'
import { toResourceFieldId } from '@auxx/types/field'
import { and, eq, sql } from 'drizzle-orm'
import type { Condition, ConditionGroup } from '../../conditions/types'
import type {
  DashboardLayoutDoc,
  GroupBy,
  LayoutTab,
  LayoutWidget,
  Metric,
  TrendCompare,
  WidgetConfiguration,
  WidgetFieldRef,
  WidgetSource,
} from '../../dashboards/client'
import { dashboardLayoutDocSchema } from '../../dashboards/config-schemas'
import {
  type InsertPublishedDashboardInput,
  insertPublishedDashboard,
} from '../../dashboards/dashboard-mutations'
import { parseSymbolicRef, SYSTEM_REF_PREFIX } from '../../entity-templates/types'
import {
  DEFAULT_DASHBOARD_CONFIGS,
  type DefaultDashboardDefinition,
  type SeedLayoutDoc,
} from '../default-dashboard-configs'
import { buildFieldIdMap, type ResolvableFieldMap } from './create-default-views'
import type { EntityDefMap, FieldMap } from './types'

const logger = createScopedLogger('entity-seeder:create-default-dashboards')

/**
 * Virtual EntityInstance timestamp columns (`ENTITY_INSTANCE_COLUMNS`) never get
 * CustomField rows — the UI and aggregate engine reference them by their STATIC
 * registry field ids (`${defId}:createdAt`), so the resolver's field map needs
 * these as fallbacks or every widget touching created/updated dates drops.
 */
const VIRTUAL_FIELD_IDS: ReadonlyArray<[symbolicRef: string, staticFieldId: string]> = [
  ['field_created_at', 'createdAt'],
  ['field_updated_at', 'updatedAt'],
]

/**
 * The minimal entity-def shape the resolver needs — satisfied by both the entity-seeder's
 * `EntityDefMap` (fresh-org path) and a migration's `ExistingState.entityDefs` (existing-org
 * path), same "share the shape, not the type" convention as `ResolvableFieldMap`
 * (create-default-views.ts).
 */
export type ResolvableEntityDefMap = Map<string, { id: string }>

/**
 * Pass N: Create Default Entity Dashboards (Dashboards v2 plan 03).
 * Seeds the `DEFAULT_DASHBOARD_CONFIGS` templates (ticket/contact/company) for a fresh org.
 * Idempotent per entity type via `ensureDefaultDashboard` — safe to call unconditionally.
 */
export async function createDefaultDashboards(
  db: Database,
  organizationId: string,
  userId: string,
  entityDefMap: EntityDefMap,
  fieldMap: FieldMap
): Promise<void> {
  for (const [entityType, def] of Object.entries(DEFAULT_DASHBOARD_CONFIGS)) {
    if (!def) continue
    await ensureDefaultDashboard(
      db,
      organizationId,
      userId,
      entityType,
      def,
      entityDefMap,
      fieldMap
    )
  }
}

/**
 * Seed ONE default dashboard for `entityType`, for an existing org — shared by
 * `createDefaultDashboards` (fresh-org path) and migration 045 (existing-org path), exactly
 * like `entity-migrations/helpers.ts`'s `ensureDefaultTableViews` mirrors `createDefaultViews`.
 *
 * Idempotent: skips if a `Dashboard` row (including archived) already links this
 * `(organizationId, entityDefinitionId)` — never resurrect one a user deleted (README decision
 * 7 / plan 03 §1). Never throws on a bad template or missing field — drops the offending widget
 * (widget-granular) or, if the resolved doc ends up empty or fails strict validation, skips the
 * whole dashboard with a warn. A genuine unique-index race on insert is the only way this
 * function can throw, and callers (the org seeder, the per-org migration runner) already treat a
 * per-org failure as non-fatal to the overall run.
 */
export async function ensureDefaultDashboard(
  db: Database,
  organizationId: string,
  userId: string,
  entityType: string,
  def: DefaultDashboardDefinition,
  entityDefMap: ResolvableEntityDefMap,
  fieldMap: ResolvableFieldMap
): Promise<boolean> {
  const entityDef = entityDefMap.get(entityType)
  if (!entityDef) {
    logger.warn(`EntityDefinition not found for ${entityType}, skipping default dashboard seed`)
    return false
  }

  const existing = await db
    .select({ id: schema.Dashboard.id })
    .from(schema.Dashboard)
    .where(
      and(
        eq(schema.Dashboard.organizationId, organizationId),
        eq(schema.Dashboard.entityDefinitionId, entityDef.id)
      )
    )
    .limit(1)
  if (existing.length > 0) return false // already seeded (or user-created/archived) — never resurrect

  const { doc, droppedWidgets } = resolveDashboardLayout(def.layout, entityDefMap, fieldMap)
  for (const title of droppedWidgets) {
    logger.warn(`Dropped widget "${title}" from default ${entityType} dashboard`, {
      organizationId,
      reason: 'unresolvable source or field ref',
    })
  }

  const widgetCount = doc.tabs.reduce((n, tab) => n + tab.widgets.length, 0)
  if (widgetCount === 0) {
    logger.warn(`Default ${entityType} dashboard has zero widgets after resolution, skipping`, {
      organizationId,
    })
    return false
  }

  const parsed = dashboardLayoutDocSchema.safeParse(doc)
  if (!parsed.success) {
    logger.warn(`Default ${entityType} dashboard failed strict validation, skipping`, {
      organizationId,
      error: parsed.error.message,
    })
    return false
  }

  const input: InsertPublishedDashboardInput = {
    name: def.name,
    description: def.description ?? null,
    icon: def.icon ? { iconId: def.icon.iconId, color: def.icon.color ?? 'blue' } : undefined,
    entityDefinitionId: entityDef.id,
    createdById: userId,
    // Same cast `dashboard-queries.ts`'s `parseLayoutDoc` uses — zod's structural inference for
    // the widget-config union loses the precise `DashboardLayoutDoc` shape (widgets: unknown[]).
    layout: parsed.data as DashboardLayoutDoc,
  }
  await insertPublishedDashboard(db, organizationId, input)

  logger.info(`Seeded default dashboard for ${entityType}`, { organizationId, name: def.name })
  return true
}

/**
 * Delete every org's PRISTINE seeded dashboard for `entityType` — exactly one
 * version (the seeded v1) and no parked draft edits; user-touched dashboards are
 * never deleted. Dev/ops helper for re-seeding after a `DEFAULT_DASHBOARD_CONFIGS`
 * template change (`apps/worker/scripts/reseed-default-dashboard.ts`): delete,
 * then re-run migration 045's ensure to insert from the current template.
 * Returns the number of dashboards deleted.
 */
export async function deletePristineSeededDashboards(
  db: Database,
  entityType: string
): Promise<number> {
  const pristine = await db
    .select({ id: schema.Dashboard.id })
    .from(schema.Dashboard)
    .innerJoin(
      schema.EntityDefinition,
      eq(schema.EntityDefinition.id, schema.Dashboard.entityDefinitionId)
    )
    .where(
      and(
        eq(schema.EntityDefinition.entityType, entityType),
        eq(schema.Dashboard.hasUnpublishedChanges, false),
        sql`(SELECT COUNT(*) FROM "DashboardVersion" v WHERE v."dashboardId" = ${schema.Dashboard.id}) = 1`
      )
    )

  for (const row of pristine) {
    await db.delete(schema.DashboardVersion).where(eq(schema.DashboardVersion.dashboardId, row.id))
    await db.delete(schema.Dashboard).where(eq(schema.Dashboard.id, row.id))
  }
  return pristine.length
}

// ─── Resolver ──────────────────────────────────────────────────────────────

/**
 * Resolve a `SeedLayoutDoc` template into a concrete `DashboardLayoutDoc`: every widget's
 * `@system:<entityType>` source and `field_<systemAttribute>` refs are rewritten against THIS
 * ORG's real ids. Missing-ref policy is widget-granular (plan 03 §"Resolver + inserter" step 3)
 * — an unresolvable source or field ref drops that ONE widget (with the title reported in
 * `droppedWidgets`), never the whole dashboard. Callers validate the survivors against the
 * strict `dashboardLayoutDocSchema` and skip the dashboard entirely if none remain.
 */
export function resolveDashboardLayout(
  layout: SeedLayoutDoc,
  entityDefMap: ResolvableEntityDefMap,
  fieldMap: ResolvableFieldMap
): { doc: DashboardLayoutDoc; droppedWidgets: string[] } {
  const droppedWidgets: string[] = []
  const tabs: LayoutTab[] = layout.tabs.map((tab) => {
    const widgets: LayoutWidget[] = []
    for (const widget of tab.widgets) {
      const resolved = resolveWidget(widget, entityDefMap, fieldMap)
      if (resolved) widgets.push(resolved)
      else droppedWidgets.push(widget.title)
    }
    return { ...tab, widgets }
  })
  return { doc: { tabs, globalFilters: layout.globalFilters }, droppedWidgets }
}

/** Resolve one widget, or `null` if its source or any referenced field can't be resolved. */
function resolveWidget(
  widget: LayoutWidget,
  entityDefMap: ResolvableEntityDefMap,
  fieldMap: ResolvableFieldMap
): LayoutWidget | null {
  const config = widget.configuration
  // richText/iframe carry no source or field refs — nothing to resolve.
  if (config.kind === 'richText' || config.kind === 'iframe') return widget

  const source = config.source
  if (source.kind !== 'entity' || !source.entityDefinitionId.startsWith(SYSTEM_REF_PREFIX)) {
    logger.warn(`Widget "${widget.title}" has a non-symbolic source; dropping`)
    return null
  }

  const { target: entityType } = parseSymbolicRef(source.entityDefinitionId)
  const entityDef = entityDefMap.get(entityType)
  if (!entityDef) return null

  const fieldIdMap = buildFieldIdMap(entityType, fieldMap)
  for (const [symbolicRef, staticFieldId] of VIRTUAL_FIELD_IDS) {
    if (!fieldIdMap.has(symbolicRef)) fieldIdMap.set(symbolicRef, staticFieldId)
  }
  const resolveRef = (ref: WidgetFieldRef | undefined): ResourceFieldId | undefined => {
    if (ref === undefined) return undefined
    if (Array.isArray(ref)) return undefined // FieldPath traversal isn't used by seed templates
    const fieldId = fieldIdMap.get(ref as string)
    return fieldId ? toResourceFieldId(entityDef.id, fieldId) : undefined
  }

  const resolvedSource: WidgetSource = { kind: 'entity', entityDefinitionId: entityDef.id }

  const filtersResult = resolveFilters(config.filters, fieldIdMap, entityDef.id)
  if (filtersResult === 'unresolvable') return null

  let globalDateFieldRef: WidgetFieldRef | null | undefined
  if (config.globalDateFieldRef === null) {
    globalDateFieldRef = null
  } else if (config.globalDateFieldRef !== undefined) {
    const resolved = resolveRef(config.globalDateFieldRef)
    if (!resolved) return null
    globalDateFieldRef = resolved
  }

  const base = { ...config, source: resolvedSource, filters: filtersResult, globalDateFieldRef }

  switch (config.kind) {
    case 'barChart':
    case 'lineChart': {
      const metric = resolveMetric(config.metric, resolveRef)
      if (!metric) return null
      const groupBy = resolveGroupBy(config.groupBy, resolveRef)
      if (!groupBy) return null
      const secondaryGroupBy = config.secondaryGroupBy
        ? resolveGroupBy(config.secondaryGroupBy, resolveRef)
        : undefined
      if (config.secondaryGroupBy && !secondaryGroupBy) return null
      return {
        ...widget,
        configuration: { ...base, metric, groupBy, secondaryGroupBy } as WidgetConfiguration,
      }
    }
    case 'pieChart': {
      const metric = resolveMetric(config.metric, resolveRef)
      if (!metric) return null
      const groupBy = resolveGroupBy(config.groupBy, resolveRef)
      if (!groupBy) return null
      return { ...widget, configuration: { ...base, metric, groupBy } as WidgetConfiguration }
    }
    case 'kpi': {
      const metric = resolveMetric(config.metric, resolveRef)
      if (!metric) return null
      const trend = config.trend ? resolveTrend(config.trend, resolveRef) : undefined
      if (config.trend && !trend) return null
      return { ...widget, configuration: { ...base, metric, trend } as WidgetConfiguration }
    }
    case 'gauge': {
      const metric = resolveMetric(config.metric, resolveRef)
      if (!metric) return null
      return { ...widget, configuration: { ...base, metric } as WidgetConfiguration }
    }
    case 'recordList': {
      const columns = config.columns
        .map((c) => resolveRef(c))
        .filter((c): c is ResourceFieldId => c !== undefined)
      if (columns.length === 0) return null
      const sort = config.sort ? resolveSort(config.sort, resolveRef) : undefined
      if (config.sort && !sort) return null
      return { ...widget, configuration: { ...base, columns, sort } as WidgetConfiguration }
    }
    default:
      return null
  }
}

function resolveMetric(
  metric: Metric,
  resolveRef: (ref: WidgetFieldRef | undefined) => ResourceFieldId | undefined
): Metric | null {
  if (!metric.fieldRef) return metric
  const resolved = resolveRef(metric.fieldRef)
  return resolved ? { ...metric, fieldRef: resolved } : null
}

function resolveGroupBy(
  groupBy: GroupBy,
  resolveRef: (ref: WidgetFieldRef | undefined) => ResourceFieldId | undefined
): GroupBy | null {
  const resolved = resolveRef(groupBy.fieldRef)
  return resolved ? { ...groupBy, fieldRef: resolved } : null
}

function resolveTrend(
  trend: { dateFieldRef: WidgetFieldRef; compare: TrendCompare },
  resolveRef: (ref: WidgetFieldRef | undefined) => ResourceFieldId | undefined
): { dateFieldRef: WidgetFieldRef; compare: TrendCompare } | null {
  const resolved = resolveRef(trend.dateFieldRef)
  return resolved ? { ...trend, dateFieldRef: resolved } : null
}

function resolveSort(
  sort: { fieldRef: WidgetFieldRef; desc: boolean },
  resolveRef: (ref: WidgetFieldRef | undefined) => ResourceFieldId | undefined
): { fieldRef: WidgetFieldRef; desc: boolean } | null {
  const resolved = resolveRef(sort.fieldRef)
  return resolved ? { ...sort, fieldRef: resolved } : null
}

/**
 * Rewrite a widget's filter conditions' symbolic `fieldId`s against the widget's own field map.
 * Returns `'unresolvable'` (drop the whole widget) if any condition references an unknown field
 * or a non-string `fieldId` shape — seed templates only ever author the simple single-field-ref
 * form, so anything else means a template bug, not a normal missing-field case.
 */
function resolveFilters(
  filters: ConditionGroup[] | undefined,
  fieldIdMap: Map<string, string>,
  entityDefId: string
): ConditionGroup[] | undefined | 'unresolvable' {
  if (!filters) return undefined
  const groups: ConditionGroup[] = []
  for (const group of filters) {
    const conditions: Condition[] = []
    for (const condition of group.conditions) {
      if (typeof condition.fieldId !== 'string') return 'unresolvable'
      const fieldId = fieldIdMap.get(condition.fieldId)
      if (!fieldId) return 'unresolvable'
      conditions.push({ ...condition, fieldId: toResourceFieldId(entityDefId, fieldId) })
    }
    groups.push({ ...group, conditions })
  }
  return groups
}
