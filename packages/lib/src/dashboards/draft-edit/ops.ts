// packages/lib/src/dashboards/draft-edit/ops.ts

/**
 * Dashboard draft mutations (`plans/dashboard/v3/01-draft-edit-module.md` §4,
 * amended by `00-reuse-audit.md` §4). SERVER-ONLY writes.
 *
 * Every mutation runs ONE pipeline, and that is the whole design:
 *
 * ```
 * loadDraftContext
 *   -> captureDashboardTurnSnapshot (first write of the turn; idempotent)
 *   -> resolve refs (widget / tab titles, and friendly source/field/filter input)
 *   -> apply via the layout-ops transform
 *   -> validateDashboard
 *   -> persistLayout (CAS on the loaded layoutHash)
 *   -> recordDashboardTurnPostHash
 *   -> publishDraftUpdatedSignal
 *   -> LayoutMutationResult
 * ```
 *
 * NO LAYOUT MATHS LIVES HERE. Every document transform is a call into
 * `../layout-ops`, which the browser draft store calls too. That shared
 * definition is the entire point of the reuse audit: a server-side `add_widget`
 * that placed widgets by its own rules would drift from where the canvas puts
 * them, and a server-side default config that differed from the panel's would
 * produce widgets the UI then treats as a different shape.
 *
 * ALL INPUT IS FRIENDLY. Sources, fields and filter values arrive as the names
 * a person says out loud and are normalized in `./normalize/*` before they
 * reach a transform. That is a correctness requirement rather than an
 * ergonomic one: entity-definition ids are per-org cuids a model cannot know, a
 * `WidgetFieldRef` is a branded `defId:fieldId`, select filter values are
 * option keys and not labels, and a filter condition the builders cannot
 * compile is dropped SILENTLY at render time. See each normalize module for the
 * full argument.
 *
 * THE SPLIT: structural and unresolvable errors REJECT before persisting
 * (`applied: false`, with `blockedBy` naming the causes). Config-level problems
 * (an unconfigured widget, a gauge with no target) PERSIST and come back as
 * `issues`. A half-built dashboard is legitimate: it is what the canvas looks
 * like every time a human adds a widget and then picks its source. Same split
 * `graph-edit/ops.ts` documents, and the reason the draft schema is permissive
 * while the publish schema is strict.
 *
 * NO permission checks live here (house rule): callers assert
 * `capabilities.assertEditInstance('dashboard', dashboardId)` before calling in.
 */

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import type { ConditionGroup } from '../../conditions'
import { type AuxxError, BadRequestError, ConflictError } from '../../errors'
import type {
  DashboardGlobalFilters,
  DashboardLayoutDoc,
  DateGranularity,
  DateRangePreset,
  GroupSort,
  LayoutWidget,
  MetricOp,
  TrendCompare,
  WidgetConfiguration,
  WidgetKind,
  WidgetSource,
} from '../client'
import { droppedFieldsOnConvert, isDataWidget, MAX_TABS, WIDGET_KIND_LABELS } from '../client'
import { hashLayoutDoc } from '../config-hash'
import { draftLayoutDocSchema } from '../config-schemas'
import * as layout from '../layout-ops'
import { resolveFieldRef } from './normalize/field-refs'
import { normalizeFilters } from './normalize/filters'
import { describeSourceForOrg, resolveWidgetSource } from './normalize/source-refs'
import { persistLayout, publishDraftUpdatedSignal } from './persist'
import { buildLayoutSummary, buildWidgetSummary, type DraftContext, loadDraftContext } from './read'
import { allWidgets, formatWidgetRef, resolveTabRef, resolveWidgetRef } from './refs'
import { captureDashboardTurnSnapshot, recordDashboardTurnPostHash } from './turn-snapshot'
import type { DashboardEditScope, Issue, LayoutMutationResult, WidgetSummary } from './types'
import { validateDashboard } from './validate'

/**
 * Scope every mutation takes: {@link DashboardEditScope} plus the turn the edit
 * belongs to. With `turnId` the pipeline captures the pre-edit doc before the
 * turn's FIRST write, so the turn's edits are reversible as a group; without it
 * (system paths, scripts) no snapshot is taken and the write is plain. A
 * `DashboardMutationScope` is assignable here.
 */
export interface DashboardOpScope extends DashboardEditScope {
  turnId?: string
}

// ── friendly input ──────────────────────────────────────────────────────────

/** A group-by dimension, named the way a person says it. */
export interface GroupByInput {
  /** Field label, key, id, or a one-hop `"relation.field"` path. */
  field: string
  dateGranularity?: DateGranularity
  sort?: GroupSort
  limit?: number
  omitEmpty?: boolean
}

/**
 * A widget's configuration in friendly terms. Every key that would hold a
 * branded ref takes a NAME instead and is resolved against the widget's own
 * source.
 *
 * `null` clears an optional key, which is the only way to unset one through a
 * shallow merge.
 */
export interface WidgetConfigInput {
  /** Entity apiSlug / label / plural / id, or a system aggregate table id. */
  source?: string
  metric?: { op: MetricOp; field?: string | null }
  groupBy?: GroupByInput | null
  secondaryGroupBy?: GroupByInput | null
  /** Record-list columns, by field name. */
  columns?: string[] | null
  sort?: { field: string; desc?: boolean } | null
  /** The date field the dashboard's global range binds to; `null` opts out. */
  globalDateField?: string | null
  trend?: { dateField: string; compare: TrendCompare } | null
  filters?: ConditionGroup[] | null
  /**
   * Display-only keys merged verbatim (color, rangeMin/rangeMax, prefix,
   * suffix, stacked, donut, url, content, pageSize, ...). A `null` value
   * deletes the key.
   *
   * Every key that carries a field ref, a source or a filter is REFUSED here:
   * letting one through would be a door around the normalization above, and the
   * whole point of this module is that there is no such door.
   */
  options?: Record<string, unknown>
}

/**
 * The friendly keys that only mean something on a data widget. Named so a
 * `groupBy` sent to a rich-text note is refused rather than dropped.
 */
const DATA_CONFIG_KEYS = [
  'metric',
  'groupBy',
  'secondaryGroupBy',
  'columns',
  'sort',
  'globalDateField',
  'trend',
  'filters',
] as const

/** Config keys that may only be set through their friendly counterpart. */
const RESERVED_OPTION_KEYS = new Set([
  'kind',
  'source',
  'metric',
  'groupBy',
  'secondaryGroupBy',
  'columns',
  'sort',
  'filters',
  'globalDateFieldRef',
  'trend',
])

// ── the shared pipeline ─────────────────────────────────────────────────────

/** What a specific mutation hands the shared pipeline. */
interface MutationPlan {
  doc: DashboardLayoutDoc
  /** Widgets this mutation created or edited: the `preExisting` boundary. */
  touchedWidgetIds?: string[]
  /** Summaries built on the PRE-edit doc, for ops whose subject is now gone. */
  removedWidgets?: WidgetSummary[]
  /** Findings that must NOT block: dropped stale refs, conversion losses. */
  warnings?: Issue[]
}

/** A refusal, as the issue shape the result carries. */
function blockingIssue(message: string, widgetRef?: string): Issue {
  return { severity: 'error', message, ...(widgetRef ? { widgetRef } : {}) }
}

/** The refused-before-persisting result: nothing was written. */
function refused(doc: DashboardLayoutDoc, blockedBy: Issue[]): LayoutMutationResult {
  const existing = validateDashboard(doc).issues.map((issue) => ({ ...issue, preExisting: true }))
  return {
    applied: false,
    issues: [...blockedBy, ...existing],
    blockedBy,
    layoutSummary: buildLayoutSummary(doc),
  }
}

/** Turn an `AuxxError` from a resolver into the blocking issue shape. */
function toBlocking(error: AuxxError, widgetRef?: string): Issue {
  return blockingIssue(error.message, widgetRef)
}

async function runDashboardMutation(
  db: Database,
  scope: DashboardOpScope,
  build: (ctx: DraftContext) => Promise<Result<MutationPlan, Issue[]>>
): Promise<Result<LayoutMutationResult, AuxxError>> {
  const loaded = await loadDraftContext(db, scope)
  if (loaded.isErr()) return err(loaded.error)
  const ctx = loaded.value

  const planned = await build(ctx)
  if (planned.isErr()) return ok(refused(ctx.doc, planned.error))
  const plan = planned.value

  // The DRAFT schema, not the publish schema. A doc that fails it would be
  // refused by `saveDraft` as a raw error from inside the persist seam, which
  // is a stack-trace-shaped answer to a structural problem the caller can act
  // on. Catch it here and report it as a refusal instead.
  const draftParse = draftLayoutDocSchema.safeParse(plan.doc)
  if (!draftParse.success) {
    return ok(
      refused(
        ctx.doc,
        draftParse.error.issues.map((issue) =>
          blockingIssue(`${issue.path.map(String).join('.') || 'layout'}: ${issue.message}`)
        )
      )
    )
  }

  const validation = validateDashboard(plan.doc)
  const issues: Issue[] = [...(plan.warnings ?? []), ...validation.issues]

  // Mark what this edit did NOT cause. A mutation reports the whole doc's
  // issues, so an untouched widget's long-standing problem is otherwise
  // indistinguishable from damage this call just did, and a caller that cannot
  // tell them apart keeps "fixing" widgets it never touched.
  const touchedRefs = new Set(
    (plan.touchedWidgetIds ?? []).map((id) => formatWidgetRef(plan.doc, id))
  )
  for (const issue of issues) {
    if (issue.widgetRef && !touchedRefs.has(issue.widgetRef)) issue.preExisting = true
  }

  const summary = buildLayoutSummary(plan.doc)
  const touchedWidget = plan.touchedWidgetIds?.length
    ? findWidgetById(plan.doc, plan.touchedWidgetIds[plan.touchedWidgetIds.length - 1] as string)
    : undefined

  // NO-OP SHORT-CIRCUIT. Without it a caller cannot tell "my edit landed" from
  // "my edit was already the state", so it re-issues the same write. Stays
  // `applied: true` because the requested state holds; `applied: false` is the
  // refusal vocabulary and telling a model a harmless idempotent write failed
  // is the loop this reports its way out of.
  const before = ctx.layoutHash ?? hashLayoutDoc(ctx.doc)
  if (hashLayoutDoc(plan.doc) === before) {
    return ok({
      applied: true,
      unchanged: true,
      ...(touchedWidget ? { widget: touchedWidget } : {}),
      issues,
      layoutSummary: summary,
    })
  }

  // Captured only now that the write is certain to be attempted, so a refused
  // mutation never marks the turn as having written. Idempotent per turn: only
  // the FIRST write captures, or whole-turn Undo degrades to undo-the-last-edit.
  if (scope.turnId !== undefined) {
    await captureDashboardTurnSnapshot(scope.dashboardId, scope.turnId, ctx.doc)
  }

  const persisted = await persistLayout(db, scope, {
    doc: plan.doc,
    ...(ctx.layoutHash !== undefined ? { expectedLayoutHash: ctx.layoutHash } : {}),
  })
  if (persisted.isErr()) {
    if (persisted.error instanceof ConflictError) {
      return err(
        new ConflictError(
          'The dashboard draft changed while this edit was being prepared: another save landed ' +
            'first. Re-read the dashboard and retry on the fresh layout. Nothing was overwritten.'
        )
      )
    }
    return err(persisted.error)
  }

  if (scope.turnId !== undefined) {
    await recordDashboardTurnPostHash(scope.dashboardId, scope.turnId, persisted.value.layoutHash)
  }

  await publishDraftUpdatedSignal(scope.organizationId, {
    dashboardId: scope.dashboardId,
    ...(plan.touchedWidgetIds?.length ? { widgetIds: plan.touchedWidgetIds } : {}),
    reason: scope.turnId !== undefined ? 'kopilot' : 'system',
  })

  return ok({
    applied: true,
    ...(touchedWidget ? { widget: touchedWidget } : {}),
    ...(plan.removedWidgets ? { widgets: plan.removedWidgets } : {}),
    issues,
    layoutSummary: summary,
  })
}

function findWidgetById(doc: DashboardLayoutDoc, widgetId: string): WidgetSummary | undefined {
  const pair = allWidgets(doc).find((p) => p.widget.id === widgetId)
  return pair ? buildWidgetSummary(doc, pair.widget, pair.tab) : undefined
}

/** `base` if free, else `base 2`, `base 3`, ... uniquified across the WHOLE doc.
 *
 * Doc-wide rather than per-tab (which is what `layout-ops.uniqueTitle` does for
 * the canvas) because a title IS the model's address for a widget: two widgets
 * sharing one on different tabs makes `resolveWidgetRef` answer with an
 * ambiguity error for both. */
function uniqueTitleInDoc(doc: DashboardLayoutDoc, base: string, excludeId?: string): string {
  const taken = allWidgets(doc)
    .filter((p) => p.widget.id !== excludeId)
    .map((p) => p.widget.title)
  return layout.uniqueTitle(base, taken)
}

// ── config resolution ───────────────────────────────────────────────────────

interface ResolvedConfig {
  config: WidgetConfiguration
  warnings: string[]
}

/** The field-ref-bearing config keys, and how each is read back off a config. */
const REF_KEYS = [
  'metric',
  'groupBy',
  'secondaryGroupBy',
  'columns',
  'sort',
  'globalDateFieldRef',
  'trend',
] as const

/**
 * Build the configuration a widget should hold, merging friendly input over an
 * existing config and resolving every name against the widget's own source.
 *
 * WHY THE SOURCE CHANGE DROPS STALE REFS. `layoutDocRefine` runs on the DRAFT
 * schema too, and it refuses the whole document when a field ref's root def
 * differs from its widget's source. So repointing a widget at another entity
 * while its metric still names the old one does not degrade that widget: it
 * makes the entire dashboard unsaveable. The refs that were not re-supplied in
 * the same call are therefore dropped, and every drop is reported as a warning
 * naming what went, so the caller can put it back rather than discover it later.
 * Stale filters go the same way: `collectFieldRefs` does not walk them, so they
 * would pass the refinement and then be dropped silently at query time.
 */
async function resolveWidgetConfig(
  orgId: string,
  base: WidgetConfiguration,
  input: WidgetConfigInput
): Promise<Result<ResolvedConfig, AuxxError>> {
  const options = input.options ?? {}
  for (const key of Object.keys(options)) {
    if (RESERVED_OPTION_KEYS.has(key)) {
      return err(
        new BadRequestError(
          `"${key}" cannot be set through options. ${
            key === 'kind'
              ? 'Changing a widget kind is what changeWidgetType is for, because it carries ' +
                'conversion rules this path does not.'
              : `Use the "${key}" input instead, so its names are resolved against the widget's source.`
          }`
        )
      )
    }
  }

  const next = { ...base } as WidgetConfiguration & Record<string, unknown>
  const warnings: string[] = []
  const dataWidget = isDataWidget(base)

  // ── source ──
  let source = dataWidget ? (base as { source?: WidgetSource }).source : undefined
  let sourceChanged = false
  if (input.source !== undefined) {
    if (!dataWidget) {
      return err(
        new BadRequestError(
          `A ${WIDGET_KIND_LABELS[base.kind]} widget reads no data, so it has no source.`
        )
      )
    }
    const resolved = await resolveWidgetSource(orgId, input.source)
    if (resolved.isErr()) return err(resolved.error)
    sourceChanged = sourceKey(source) !== sourceKey(resolved.value)
    source = resolved.value
    next.source = resolved.value
  }

  if (!dataWidget) {
    // A rich-text note and an embed have no metric, no dimension and no filter,
    // so silently dropping one would leave the caller believing it landed.
    const dataKeys = DATA_CONFIG_KEYS.filter((key) => input[key] !== undefined)
    if (dataKeys.length > 0) {
      return err(
        new BadRequestError(
          `A ${WIDGET_KIND_LABELS[base.kind]} widget reads no data, so it has no ` +
            `${dataKeys.join(', ')}.`
        )
      )
    }
    applyOptions(next, options)
    return ok({ config: next as WidgetConfiguration, warnings })
  }

  if (!source) {
    // Nothing to resolve names against. Anything that would need a ref is
    // refused rather than guessed at; display options still apply, so a
    // half-configured widget is still reachable.
    for (const key of [
      'metric',
      'groupBy',
      'secondaryGroupBy',
      'columns',
      'sort',
      'trend',
    ] as const) {
      const value = input[key]
      if (value != null && !(key === 'metric' && (value as { field?: string }).field == null)) {
        return err(
          new BadRequestError(
            `Set the widget's source before its ${key}: field names are resolved against the ` +
              'source, so there is nothing to resolve them against yet.'
          )
        )
      }
    }
    if (input.filters != null) {
      return err(
        new BadRequestError(
          "Set the widget's source before its filters: field names are resolved against the " +
            'source, so there is nothing to resolve them against yet.'
        )
      )
    }
    if (input.metric !== undefined && input.metric !== null) next.metric = { op: input.metric.op }
    applyOptions(next, options)
    return ok({ config: next as WidgetConfiguration, warnings })
  }

  const label = await describeSourceForOrg(orgId, source)
  const ref = (name: string) => resolveFieldRef(orgId, source as WidgetSource, name, label)

  // Drop refs the new source cannot carry, unless this same call replaces them.
  if (sourceChanged) {
    for (const key of REF_KEYS) {
      const supplied =
        key === 'globalDateFieldRef'
          ? input.globalDateField !== undefined
          : input[key] !== undefined
      if (supplied || next[key] === undefined) continue
      warnings.push(
        `dropped "${key}" because the source changed to ${label}; it named a field of the ` +
          'previous source.'
      )
      delete next[key]
    }
    if (input.filters === undefined && next.filters !== undefined) {
      warnings.push(`dropped the filters because the source changed to ${label}.`)
      delete next.filters
    }
  }

  // ── metric ──
  if (input.metric !== undefined) {
    if (input.metric === null) {
      delete next.metric
    } else {
      const metric: { op: MetricOp; fieldRef?: unknown } = { op: input.metric.op }
      if (input.metric.field != null) {
        const resolved = await ref(input.metric.field)
        if (resolved.isErr()) return err(resolved.error)
        metric.fieldRef = resolved.value
      }
      next.metric = metric
    }
  }

  // ── group-bys ──
  for (const key of ['groupBy', 'secondaryGroupBy'] as const) {
    const value = input[key]
    if (value === undefined) continue
    if (value === null) {
      delete next[key]
      continue
    }
    const resolved = await ref(value.field)
    if (resolved.isErr()) return err(resolved.error)
    next[key] = {
      fieldRef: resolved.value,
      ...(value.dateGranularity !== undefined ? { dateGranularity: value.dateGranularity } : {}),
      ...(value.sort !== undefined ? { sort: value.sort } : {}),
      ...(value.limit !== undefined ? { limit: value.limit } : {}),
      ...(value.omitEmpty !== undefined ? { omitEmpty: value.omitEmpty } : {}),
    }
  }

  // ── record-list columns + sort ──
  if (input.columns !== undefined) {
    if (input.columns === null) {
      next.columns = []
    } else {
      const columns: unknown[] = []
      for (const name of input.columns) {
        const resolved = await ref(name)
        if (resolved.isErr()) return err(resolved.error)
        columns.push(resolved.value)
      }
      next.columns = columns
    }
  }
  if (input.sort !== undefined) {
    if (input.sort === null) {
      delete next.sort
    } else {
      const resolved = await ref(input.sort.field)
      if (resolved.isErr()) return err(resolved.error)
      next.sort = { fieldRef: resolved.value, desc: input.sort.desc ?? false }
    }
  }

  // ── the global date binding + the KPI trend ──
  if (input.globalDateField !== undefined) {
    if (input.globalDateField === null) {
      next.globalDateFieldRef = null
    } else {
      const resolved = await ref(input.globalDateField)
      if (resolved.isErr()) return err(resolved.error)
      next.globalDateFieldRef = resolved.value
    }
  }
  if (input.trend !== undefined) {
    if (input.trend === null) {
      delete next.trend
    } else {
      const resolved = await ref(input.trend.dateField)
      if (resolved.isErr()) return err(resolved.error)
      next.trend = { dateFieldRef: resolved.value, compare: input.trend.compare }
    }
  }

  // ── filters ──
  if (input.filters !== undefined) {
    if (input.filters === null) {
      delete next.filters
    } else {
      const normalized = await normalizeFilters(orgId, source, input.filters, label)
      if (normalized.isErr()) return err(normalized.error)
      next.filters = normalized.value
    }
  }

  applyOptions(next, options)
  return ok({ config: next as WidgetConfiguration, warnings })
}

/**
 * Merge display-only keys. A `null` value DELETES the key, which is the only
 * way to clear an optional through a shallow merge, except for `content` and
 * `url`: on a rich-text note and an embed those are nullable by definition, and
 * `null` is how they are emptied rather than removed.
 */
function applyOptions(config: Record<string, unknown>, options: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(options)) {
    if (value === null && key !== 'content' && key !== 'url') delete config[key]
    else config[key] = value
  }
}

/** Identity of a source, for "did it change" comparisons. */
function sourceKey(source: WidgetSource | undefined): string | undefined {
  if (!source) return undefined
  return source.kind === 'system'
    ? `system:${source.tableId}`
    : `entity:${source.entityDefinitionId}`
}

/** Warnings as issues attached to the widget they belong to. */
function warningIssues(warnings: string[], widgetRef: string): Issue[] {
  return warnings.map((message) => ({
    severity: 'warning' as const,
    message: `Widget "${widgetRef}" ${message}`,
    widgetRef,
  }))
}

// ── operations ──────────────────────────────────────────────────────────────

/** {@link addWidget} input. Grid coordinates are deliberately absent: placement
 * is automatic (`findNextFreePosition`), and `arrangeWidgets` is the one op that
 * takes positions. */
export interface AddWidgetInput extends WidgetConfigInput {
  kind: WidgetKind
  /** Tab ref; defaults to the first tab. */
  tab?: string
  /** Defaults to the kind's label, de-duplicated across the doc. */
  title?: string
}

/**
 * Add a widget to a tab. Placement, id, default configuration and title all
 * come from `layout-ops`, so a Kopilot-added widget is byte-identical to a
 * canvas-added one. When the dashboard is entity-linked the source prefills to
 * that def, matching what the browser store does today.
 */
export async function addWidget(
  db: Database,
  scope: DashboardOpScope,
  input: AddWidgetInput
): Promise<Result<LayoutMutationResult, AuxxError>> {
  return runDashboardMutation(db, scope, async (ctx) => {
    let tabId = ctx.doc.tabs[0]?.id
    if (input.tab) {
      const tab = resolveTabRef(ctx.doc, input.tab)
      if (tab.isErr()) return err([toBlocking(tab.error)])
      tabId = tab.value.tab.id
    }
    if (!tabId) {
      return err([blockingIssue('This dashboard has no tab to add a widget to. Add a tab first.')])
    }

    const added = layout.addWidget(ctx.doc, {
      tabId,
      kind: input.kind,
      entityDefinitionId: ctx.entityDefinitionId,
    })
    if (!added) return err([blockingIssue(`No tab matches "${input.tab}".`)])

    let doc = added.doc
    const title = uniqueTitleInDoc(
      doc,
      input.title?.trim() || layout.defaultWidgetTitle(input.kind),
      added.id
    )
    doc = layout.patchWidget(doc, added.id, { title })

    const current = allWidgets(doc).find((p) => p.widget.id === added.id)?.widget
    if (!current) return err([blockingIssue('The widget could not be placed.')])

    const resolved = await resolveWidgetConfig(scope.organizationId, current.configuration, input)
    if (resolved.isErr()) return err([toBlocking(resolved.error, title)])
    doc = layout.setWidgetConfig(doc, added.id, resolved.value.config)

    return ok({
      doc,
      touchedWidgetIds: [added.id],
      warnings: warningIssues(resolved.value.warnings, title),
    })
  })
}

/** {@link updateWidget} input. */
export interface UpdateWidgetInput extends WidgetConfigInput {
  /** Widget ref: title, unique title prefix, or id. */
  widget: string
  title?: string
}

/**
 * Update one widget. The configuration is a SHALLOW MERGE over what the widget
 * already holds, so a caller can set a group-by without restating the metric;
 * `null` on an optional key clears it.
 *
 * A widget's KIND is not settable here. That is `changeWidgetType`'s job,
 * because converting carries rules (which config survives, the span clamp, the
 * retitle-if-default) that a merge would silently skip.
 */
export async function updateWidget(
  db: Database,
  scope: DashboardOpScope,
  input: UpdateWidgetInput
): Promise<Result<LayoutMutationResult, AuxxError>> {
  return runDashboardMutation(db, scope, async (ctx) => {
    const found = resolveWidgetRef(ctx.doc, input.widget)
    if (found.isErr()) return err([toBlocking(found.error)])
    const { widget } = found.value

    let doc = ctx.doc
    let ref = formatWidgetRef(doc, widget.id)
    if (input.title !== undefined) {
      const title = uniqueTitleInDoc(doc, input.title.trim(), widget.id)
      if (!title) return err([blockingIssue('A widget title cannot be empty.', ref)])
      doc = layout.patchWidget(doc, widget.id, { title })
      ref = formatWidgetRef(doc, widget.id)
    }

    const resolved = await resolveWidgetConfig(scope.organizationId, widget.configuration, input)
    if (resolved.isErr()) return err([toBlocking(resolved.error, ref)])
    doc = layout.setWidgetConfig(doc, widget.id, resolved.value.config)

    return ok({
      doc,
      touchedWidgetIds: [widget.id],
      warnings: warningIssues(resolved.value.warnings, ref),
    })
  })
}

/** What {@link changeWidgetType} adds to the shared result. */
export interface ChangeWidgetTypeResult extends LayoutMutationResult {
  /**
   * User-facing labels for the configured fields the conversion dropped.
   * Empty means lossless. Surfaced so the caller can tell the user what it is
   * about to lose instead of discovering it afterwards.
   */
  droppedFieldsOnConvert: string[]
}

/**
 * Convert a widget to another data-widget kind. A thin wrapper over
 * `layout-ops.changeWidgetType`, which is itself a wrapper over the tested
 * `convertWidgetConfiguration`: no conversion logic is written here, and the
 * span clamp and retitle-if-default come along for free.
 *
 * `richText` and `iframe` are neither a valid source nor a valid target: they
 * carry no data configuration to convert.
 */
export async function changeWidgetType(
  db: Database,
  scope: DashboardOpScope,
  input: { widget: string; kind: WidgetKind }
): Promise<Result<ChangeWidgetTypeResult, AuxxError>> {
  let dropped: string[] = []
  const result = await runDashboardMutation(db, scope, async (ctx) => {
    const found = resolveWidgetRef(ctx.doc, input.widget)
    if (found.isErr()) return err([toBlocking(found.error)])
    const { widget } = found.value
    const ref = formatWidgetRef(ctx.doc, widget.id)

    if (widget.type === input.kind) {
      return ok({ doc: ctx.doc, touchedWidgetIds: [widget.id] })
    }
    if (
      !isDataWidget(widget.configuration) ||
      input.kind === 'richText' ||
      input.kind === 'iframe'
    ) {
      return err([
        blockingIssue(
          `A ${WIDGET_KIND_LABELS[widget.type]} cannot be converted to a ` +
            `${WIDGET_KIND_LABELS[input.kind]}: only data widgets convert between kinds. ` +
            'Delete it and add the widget you want instead.',
          ref
        ),
      ])
    }

    dropped = droppedFieldsOnConvert(widget.configuration, input.kind)
    const doc = layout.changeWidgetType(ctx.doc, widget.id, input.kind)
    return ok({
      doc,
      touchedWidgetIds: [widget.id],
      warnings:
        dropped.length > 0
          ? warningIssues(
              [`lost ${dropped.join(', ')} converting to ${WIDGET_KIND_LABELS[input.kind]}.`],
              ref
            )
          : [],
    })
  })
  return result.map((value) => ({ ...value, droppedFieldsOnConvert: dropped }))
}

/** One widget's new place on the 12-column grid. */
export interface WidgetPlacement {
  widget: string
  column: number
  row: number
  columnSpan?: number
  rowSpan?: number
}

/**
 * Move and resize widgets. The one op that takes coordinates, and it takes them
 * as 12-column grid cells rather than pixels. Columns are clamped through
 * `placeAt` and spans up to the kind's `MIN_WIDGET_SIZE`; overlaps are
 * permitted and settled by the grid's vertical compactor on the next layout
 * pass, exactly as a user drag is.
 */
export async function arrangeWidgets(
  db: Database,
  scope: DashboardOpScope,
  input: { placements: WidgetPlacement[] }
): Promise<Result<LayoutMutationResult, AuxxError>> {
  return runDashboardMutation(db, scope, async (ctx) => {
    if (input.placements.length === 0) {
      return err([blockingIssue('No placements were given.')])
    }
    const blocked: Issue[] = []
    const byTab = new Map<string, layout.GridLayoutChange[]>()
    const touched: string[] = []

    for (const placement of input.placements) {
      const found = resolveWidgetRef(ctx.doc, placement.widget)
      if (found.isErr()) {
        blocked.push(toBlocking(found.error))
        continue
      }
      const { widget, tab } = found.value
      const min = layout.minWidgetSpan(widget.type)
      const span = {
        w: Math.max(placement.columnSpan ?? widget.gridPosition.columnSpan, min.w),
        h: Math.max(placement.rowSpan ?? widget.gridPosition.rowSpan, min.h),
      }
      const gridPosition = layout.placeAt({ x: placement.column, y: placement.row }, span)
      const changes = byTab.get(tab.id) ?? []
      changes.push({ id: widget.id, gridPosition })
      byTab.set(tab.id, changes)
      touched.push(widget.id)
    }
    if (blocked.length > 0) return err(blocked)

    let doc = ctx.doc
    for (const [tabId, changes] of byTab) doc = layout.applyGridLayout(doc, tabId, changes)
    return ok({ doc, touchedWidgetIds: touched })
  })
}

/**
 * Remove widgets. Returns the removed summaries in `widgets` so an Undo card
 * and a turn digest can name what went. No approval gate: the whole-turn
 * snapshot is the recovery path.
 */
export async function deleteWidgets(
  db: Database,
  scope: DashboardOpScope,
  input: { widgets: string[] }
): Promise<Result<LayoutMutationResult, AuxxError>> {
  return runDashboardMutation(db, scope, async (ctx) => {
    if (input.widgets.length === 0) return err([blockingIssue('No widgets were named.')])
    const blocked: Issue[] = []
    const removed: WidgetSummary[] = []
    const ids: string[] = []

    for (const ref of input.widgets) {
      const found = resolveWidgetRef(ctx.doc, ref)
      if (found.isErr()) {
        blocked.push(toBlocking(found.error))
        continue
      }
      removed.push(buildWidgetSummary(ctx.doc, found.value.widget, found.value.tab))
      ids.push(found.value.widget.id)
    }
    if (blocked.length > 0) return err(blocked)

    let doc = ctx.doc
    for (const id of ids) doc = layout.removeWidget(doc, id)
    return ok({ doc, removedWidgets: removed })
  })
}

/** Append a tab. Blank or omitted titles fall back to `Tab <n>`, uniquified. */
export async function addTab(
  db: Database,
  scope: DashboardOpScope,
  input: { title?: string } = {}
): Promise<Result<LayoutMutationResult, AuxxError>> {
  return runDashboardMutation(db, scope, async (ctx) => {
    if (ctx.doc.tabs.length >= MAX_TABS) {
      return err([blockingIssue(`A dashboard may hold at most ${MAX_TABS} tabs.`)])
    }
    return ok({ doc: layout.addTab(ctx.doc, input.title).doc })
  })
}

/** Rename a tab or change its icon. */
export async function updateTab(
  db: Database,
  scope: DashboardOpScope,
  input: { tab: string; title?: string; icon?: string | null }
): Promise<Result<LayoutMutationResult, AuxxError>> {
  return runDashboardMutation(db, scope, async (ctx) => {
    const found = resolveTabRef(ctx.doc, input.tab)
    if (found.isErr()) return err([toBlocking(found.error)])
    const patch: { title?: string; icon?: string | null } = {}
    if (input.title !== undefined) {
      const title = input.title.trim()
      if (!title) return err([blockingIssue('A tab title cannot be empty.')])
      patch.title = layout.uniqueTitle(
        title,
        ctx.doc.tabs.filter((t) => t.id !== found.value.tab.id).map((t) => t.title)
      )
    }
    if (input.icon !== undefined) patch.icon = input.icon
    return ok({ doc: layout.updateTab(ctx.doc, found.value.tab.id, patch) })
  })
}

/**
 * Remove a tab and everything on it.
 *
 * The LAST tab is refused. `dashboardLayoutDocSchema` requires `tabs.min(1)`,
 * so removing it would write a draft that can never be published, and the
 * failure would surface later as a zod issue on a publish the user thought was
 * ready. Refuse at the op with something actionable instead.
 */
export async function deleteTab(
  db: Database,
  scope: DashboardOpScope,
  input: { tab: string }
): Promise<Result<LayoutMutationResult, AuxxError>> {
  return runDashboardMutation(db, scope, async (ctx) => {
    const found = resolveTabRef(ctx.doc, input.tab)
    if (found.isErr()) return err([toBlocking(found.error)])
    if (ctx.doc.tabs.length <= 1) {
      return err([
        blockingIssue(
          `"${found.value.tab.title}" is the only tab, and a dashboard must keep at least one: ` +
            'removing it would write a draft that can never be published. Delete the widgets on ' +
            'it, or add another tab first.'
        ),
      ])
    }
    return ok({ doc: layout.removeTab(ctx.doc, found.value.tab.id) })
  })
}

/** Per-source condition groups for {@link setGlobalFilters}, in friendly terms. */
export interface GlobalFilterInput {
  /** Friendly source ref; the conditions merge only into widgets on this source. */
  source: string
  groups: ConditionGroup[]
}

/**
 * Replace the dashboard-level filter DEFAULTS.
 *
 * These are the VERSIONED defaults stored on the layout doc, not the viewer's
 * live picks. Those are URL state and are not reachable from the server at all,
 * so a caller that "applies a filter" here and expects the user's open
 * dashboard to change what it shows is wrong twice over: the user has their own
 * selection, and it wins. Say so when reporting the result.
 */
export async function setGlobalFilters(
  db: Database,
  scope: DashboardOpScope,
  input: { conditions?: GlobalFilterInput[]; dateRange?: DateRangePreset | null }
): Promise<Result<LayoutMutationResult, AuxxError>> {
  return runDashboardMutation(db, scope, async (ctx) => {
    const filters: DashboardGlobalFilters = { ...(ctx.doc.globalFilters ?? {}) }

    if (input.conditions !== undefined) {
      const resolved: NonNullable<DashboardGlobalFilters['conditions']> = []
      for (const entry of input.conditions) {
        const source = await resolveWidgetSource(scope.organizationId, entry.source)
        if (source.isErr()) return err([toBlocking(source.error)])
        if (source.value.kind !== 'entity') {
          return err([
            blockingIssue(
              `Global filter conditions attach to an entity source; "${entry.source}" is a ` +
                'system table.'
            ),
          ])
        }
        const label = await describeSourceForOrg(scope.organizationId, source.value)
        const groups = await normalizeFilters(
          scope.organizationId,
          source.value,
          entry.groups,
          label
        )
        if (groups.isErr()) return err([toBlocking(groups.error)])
        resolved.push({
          entityDefinitionId: source.value.entityDefinitionId,
          groups: groups.value,
        })
      }
      filters.conditions = resolved
    }

    if (input.dateRange !== undefined) {
      if (input.dateRange === null) delete filters.dateRange
      else filters.dateRange = input.dateRange
    }

    return ok({ doc: layout.setGlobalFilters(ctx.doc, filters) })
  })
}

/** One widget in a {@link replaceLayout} tab spec. */
export interface ReplaceLayoutWidget extends WidgetConfigInput {
  kind: WidgetKind
  title?: string
}

/** One tab in a {@link replaceLayout} spec. */
export interface ReplaceLayoutTab {
  title?: string
  widgets?: ReplaceLayoutWidget[]
}

/**
 * Build a whole dashboard in one call. GREENFIELD ONLY.
 *
 * REFUSED once the draft holds any authored content, and this is the one rule
 * that keeps whole-document writes safe: a caller asked to "add a KPI" that
 * re-emits the whole doc drops every widget it failed to represent, and a
 * truncated response reads as a deletion. The targeted ops cannot delete what
 * they do not mention, so the guard costs nothing and closes that hole. It is
 * `checkBodyPreservation` reduced to the one rule that matters here.
 *
 * Coordinates are not accepted: placement is automatic, so a caller describes
 * tabs and widgets and the grid settles itself.
 */
export async function replaceLayout(
  db: Database,
  scope: DashboardOpScope,
  input: { tabs: ReplaceLayoutTab[] }
): Promise<Result<LayoutMutationResult, AuxxError>> {
  return runDashboardMutation(db, scope, async (ctx) => {
    const authored = allWidgets(ctx.doc).filter((p) => holdsAuthoredContent(p.widget))
    if (authored.length > 0) {
      return err([
        blockingIssue(
          `This dashboard already holds ${authored.length} configured widget` +
            `${authored.length === 1 ? '' : 's'} (${authored
              .slice(0, 5)
              .map((p) => `"${p.widget.title}"`)
              .join(', ')}), so it cannot be replaced wholesale: a whole-document write silently ` +
            'drops anything it fails to restate. Use addWidget, updateWidget, deleteWidgets, ' +
            'addTab and deleteTab to change it in place.'
        ),
      ])
    }
    if (input.tabs.length === 0) {
      return err([blockingIssue('A dashboard needs at least one tab.')])
    }
    if (input.tabs.length > MAX_TABS) {
      return err([blockingIssue(`A dashboard may hold at most ${MAX_TABS} tabs.`)])
    }

    let doc: DashboardLayoutDoc = { tabs: [] }
    const touched: string[] = []
    const warnings: Issue[] = []

    for (const tabSpec of input.tabs) {
      const tab = layout.addTab(doc, tabSpec.title)
      doc = tab.doc
      for (const widgetSpec of tabSpec.widgets ?? []) {
        const added = layout.addWidget(doc, {
          tabId: tab.id,
          kind: widgetSpec.kind,
          entityDefinitionId: ctx.entityDefinitionId,
        })
        if (!added) return err([blockingIssue('A widget could not be placed.')])
        doc = added.doc
        const title = uniqueTitleInDoc(
          doc,
          widgetSpec.title?.trim() || layout.defaultWidgetTitle(widgetSpec.kind),
          added.id
        )
        doc = layout.patchWidget(doc, added.id, { title })
        const current = allWidgets(doc).find((p) => p.widget.id === added.id)?.widget
        if (!current) return err([blockingIssue('A widget could not be placed.')])
        const resolved = await resolveWidgetConfig(
          scope.organizationId,
          current.configuration,
          widgetSpec
        )
        if (resolved.isErr()) return err([toBlocking(resolved.error, title)])
        doc = layout.setWidgetConfig(doc, added.id, resolved.value.config)
        warnings.push(...warningIssues(resolved.value.warnings, title))
        touched.push(added.id)
      }
    }

    if (ctx.doc.globalFilters) doc = layout.setGlobalFilters(doc, ctx.doc.globalFilters)
    return ok({ doc, touchedWidgetIds: touched, warnings })
  })
}

/**
 * Has a human (or an agent) put something in this widget yet?
 *
 * Deliberately NOT `WidgetSummary.configured`, which answers "will this
 * render": that treats an empty rich-text note as configured, and an untouched
 * starter note is exactly the state the greenfield path is for. This asks
 * whether anything would be LOST.
 */
function holdsAuthoredContent(widget: LayoutWidget): boolean {
  const config = widget.configuration
  if (config.kind === 'richText') return config.content != null
  if (config.kind === 'iframe') return config.url != null
  return Boolean((config as { source?: WidgetSource }).source)
}
