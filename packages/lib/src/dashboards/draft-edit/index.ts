// packages/lib/src/dashboards/draft-edit/index.ts

/**
 * Headless dashboard draft-edit module
 * (`plans/dashboard/v3/01-draft-edit-module.md`): friendly input in, validated
 * layout doc out.
 *
 * SERVER-ONLY entrypoint. `read.ts` and `persist.ts` reach drizzle, the
 * `turn-*` modules reach Redis, and `normalize/` reads the org cache and the
 * condition builders, so this barrel must never be exported through a client
 * bundle. It is a LEAF subpath (`@auxx/lib/dashboards/draft-edit`) and is
 * deliberately not routed through `dashboards/client.ts` or the
 * `dashboards/index.ts` barrel, the same rule the workflow catalog documents
 * for its org-cache-touching modules.
 *
 * The pure pieces (`refs.ts`, `validate.ts`, and `../layout-ops.ts`) are
 * browser-safe and can grow a dedicated client surface when a UI consumer
 * appears. `../layout-ops` already has its own subpath, because the browser
 * draft store calls the very same transforms these operations do.
 *
 * NO permission checks live anywhere in this module (house rule): callers
 * assert `capabilities.assertEditInstance('dashboard', id)` before calling in.
 */

export {
  describeFieldRef,
  describeFieldRefForSource,
  loadSourceFields,
  type ResolvedFieldTarget,
  resolveFieldRef,
  resolveFieldTarget,
  resolveOptionValue,
  sourceResourceId,
} from './normalize/field-refs'
export {
  assertWidgetFilterConditionsCompile,
  normalizeFilters,
} from './normalize/filters'
export {
  describeSource,
  describeSourceForOrg,
  resolveWidgetSource,
} from './normalize/source-refs'
export {
  type AddWidgetInput,
  addTab,
  addWidget,
  arrangeWidgets,
  type ChangeWidgetTypeResult,
  changeWidgetType,
  type DashboardOpScope,
  deleteTab,
  deleteWidgets,
  type GlobalFilterInput,
  type GroupByInput,
  type ReplaceLayoutTab,
  type ReplaceLayoutWidget,
  replaceLayout,
  setGlobalFilters,
  type UpdateWidgetInput,
  updateTab,
  updateWidget,
  type WidgetConfigInput,
  type WidgetPlacement,
} from './ops'
export {
  type PersistLayoutInput,
  type PersistLayoutOutcome,
  persistLayout,
  publishDraftUpdatedSignal,
} from './persist'
export {
  buildLayoutSummary,
  buildWidgetSummary,
  type DraftContext,
  loadDraftContext,
  summarizeWidgetConfig,
} from './read'
export {
  allWidgets,
  closestMatches,
  describeTarget,
  formatTabRef,
  formatWidgetRef,
  type RefMatchKind,
  type ResolvedTabRef,
  type ResolvedWidgetRef,
  resolveTabRef,
  resolveWidgetRef,
  type WidgetWithTab,
} from './refs'
export {
  acquireDashboardTurnLock,
  beginDashboardTurnLock,
  type DashboardTurnLock,
  endDashboardTurnLock,
  readDashboardTurnLock,
  releaseDashboardTurnLock,
} from './turn-lock'
export {
  captureDashboardTurnSnapshot,
  clearDashboardTurnSnapshot,
  type DashboardPreTurnSnapshot,
  type DashboardTurnEnding,
  finalizeDashboardTurn,
  readDashboardTurnSnapshot,
  recordDashboardTurnEnding,
  recordDashboardTurnPostHash,
  revertDashboardTurn,
} from './turn-snapshot'
export type {
  DashboardEditScope,
  DashboardMutationScope,
  Issue,
  IssueSeverity,
  LayoutMutationResult,
  LayoutSummary,
  TabSummary,
  WidgetSummary,
} from './types'
export { hasBlockingIssues, validateDashboard, widgetIssues } from './validate'
