// packages/lib/src/dashboards/draft-edit/read.ts

/**
 * Draft reads for the dashboard draft-edit module
 * (`plans/dashboard/v3/01-draft-edit-module.md` §5, amended by
 * `00-reuse-audit.md` §1.2). SERVER-ONLY (db).
 *
 * This module deliberately issues NO query of its own.
 * {@link loadDraftContext} is exactly `loadDashboardRow` + `parseDraftLayoutDoc`
 * + `hashLayoutDoc`, because every one of those already exists and a second
 * definition of "read a dashboard" is how the two drift. Everything else here
 * is a pure summariser over the doc it returns.
 *
 * The summaries strip grid coordinates (see `types.ts`) and reduce a widget's
 * configuration to ONE truncated line. Full bodies stay behind the read-one
 * path: a three-tab dashboard with twenty configured widgets is a large JSON
 * document, and re-emitting it per tool result burns the turn budget for
 * nothing.
 *
 * No permission checks live here (house rule): callers assert
 * `assertViewInstance` / `assertEditInstance` before calling in.
 */

import type { Database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
import type { AuxxError } from '../../errors'
import type { DashboardLayoutDoc, LayoutTab, LayoutWidget, WidgetConfiguration } from '../client'
import { isChartConfigured, isChartWidget } from '../client'
import { hashLayoutDoc } from '../config-hash'
import { loadDashboardRow, parseDraftLayoutDoc } from '../dashboard-queries'
import type { DashboardEntity } from '../types'
import { formatWidgetRef } from './refs'
import type { DashboardEditScope, LayoutSummary, WidgetSummary } from './types'

/** Everything a read or a mutation needs about the loaded draft. */
export interface DraftContext {
  /** The `Dashboard` row itself: the row IS the draft. */
  row: DashboardEntity
  /** The parsed `draftLayout`, or an empty doc when the row has never held one. */
  doc: DashboardLayoutDoc
  /**
   * CAS token for the next write: the hash of {@link doc}. Undefined only when
   * the row carries no stored draft at all, in which case there is nothing that
   * could have moved under the caller and the write proceeds unguarded.
   */
  layoutHash?: string
  /** The def this dashboard is pinned to, when it is entity-linked. */
  entityDefinitionId: string | null
}

/** A dashboard with no stored draft edits as an empty doc. */
const EMPTY_DOC: DashboardLayoutDoc = { tabs: [] }

/**
 * Load the dashboard row and its draft layout, with the CAS token for the next
 * write. An unparseable draft is an error rather than a silent reset: writing
 * over it would destroy whatever the row actually holds.
 */
export async function loadDraftContext(
  db: Database,
  scope: DashboardEditScope
): Promise<Result<DraftContext, AuxxError>> {
  const row = await loadDashboardRow(db, scope.organizationId, scope.dashboardId)
  if (row.isErr()) return err(row.error)

  const parsed = parseDraftLayoutDoc(row.value.draftLayout)
  if (parsed.isErr()) return err(parsed.error)

  const doc = parsed.value
  return ok({
    row: row.value,
    doc: doc ?? EMPTY_DOC,
    // Hashed from the PARSED doc, never the raw column, so it matches what a
    // persist of an unchanged doc would write back (the schema strips unknown
    // keys, so parse is a projection and hashing the raw value would make every
    // later comparison a false mismatch).
    ...(doc ? { layoutHash: hashLayoutDoc(doc) } : {}),
    entityDefinitionId: row.value.entityDefinitionId ?? null,
  })
}

/** Longest one-line config summary a widget projection carries. */
const CONFIG_SUMMARY_LIMIT = 140

/**
 * One line of config for a widget summary: the configuration as JSON minus its
 * `kind` (already carried by {@link WidgetSummary.kind}), truncated. Enough to
 * tell two widgets apart and to see what is missing, never enough to be a
 * substitute for the read-one path.
 */
export function summarizeWidgetConfig(config: WidgetConfiguration): string {
  const { kind: _kind, ...rest } = config as WidgetConfiguration & Record<string, unknown>
  let json: string
  try {
    json = JSON.stringify(rest) ?? '{}'
  } catch {
    // A richText body is arbitrary JSON from TipTap; a cycle in it must not
    // take down a read.
    json = '{}'
  }
  return json.length > CONFIG_SUMMARY_LIMIT ? `${json.slice(0, CONFIG_SUMMARY_LIMIT - 1)}…` : json
}

/**
 * Whether a widget has everything it needs to render. Charts defer to the
 * existing {@link isChartConfigured} guard; the kinds it does not cover get the
 * one check each that decides the same question.
 */
function isWidgetConfigured(widget: LayoutWidget): boolean {
  const config = widget.configuration
  if (isChartWidget(config)) {
    if (!isChartConfigured(config)) return false
    return config.kind !== 'gauge' || config.rangeMax != null
  }
  if (config.kind === 'recordList') return Boolean(config.source && config.columns?.length)
  if (config.kind === 'iframe') return config.url != null
  return true
}

/** Project one widget for the model. Grid coordinates are deliberately absent. */
export function buildWidgetSummary(
  doc: DashboardLayoutDoc,
  widget: LayoutWidget,
  tab: LayoutTab
): WidgetSummary {
  return {
    ref: formatWidgetRef(doc, widget.id),
    id: widget.id,
    tab: tab.title,
    kind: widget.type,
    config: summarizeWidgetConfig(widget.configuration),
    configured: isWidgetConfigured(widget),
  }
}

/**
 * The whole doc at a glance. Cheap enough to ride every mutation result, which
 * is the point: a caller should never need a follow-up read just to learn what
 * its own edit did to the shape of the dashboard.
 */
export function buildLayoutSummary(doc: DashboardLayoutDoc): LayoutSummary {
  let widgetCount = 0
  let unconfiguredCount = 0
  for (const tab of doc.tabs) {
    for (const widget of tab.widgets) {
      widgetCount++
      if (!isWidgetConfigured(widget)) unconfiguredCount++
    }
  }
  return {
    tabCount: doc.tabs.length,
    widgetCount,
    unconfiguredCount,
    tabs: doc.tabs.map((tab) => ({
      ref: tab.title,
      id: tab.id,
      widgetCount: tab.widgets.length,
    })),
  }
}
