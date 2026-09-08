// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/index.ts

import { createScopedLogger } from '@auxx/logger'
import { findRef } from '../../context-refs'
import { buildDashboardBuilderPromptSection } from '../../prompts/sections/dashboard-builder'
import type { GetToolDeps, PageCapability } from '../types'
import { DASHBOARD_BUILDER_PAGE } from './client'
import { createAddTabTool } from './tools/add-tab'
import { createAddWidgetTool } from './tools/add-widget'
import { createArrangeWidgetsTool } from './tools/arrange-widgets'
import { createChangeWidgetTypeTool } from './tools/change-widget-type'
import { createDeleteTabTool } from './tools/delete-tab'
import { createDeleteWidgetsTool } from './tools/delete-widgets'
import { createDescribeWidgetKindTool } from './tools/describe-widget-kind'
import { createGetDashboardTool } from './tools/get-dashboard'
import { createGetWidgetTool } from './tools/get-widget'
import { createListDashboardSourcesTool } from './tools/list-dashboard-sources'
import { createListWidgetKindsTool } from './tools/list-widget-kinds'
import { createPreviewWidgetTool } from './tools/preview-widget'
import { createReplaceLayoutTool } from './tools/replace-layout'
import { createSetGlobalFiltersTool } from './tools/set-global-filters'
import { createUpdateTabTool } from './tools/update-tab'
import { createUpdateWidgetTool } from './tools/update-widget'
import { createValidateDashboardTool } from './tools/validate-dashboard'

export { DASHBOARD_BUILDER_PAGE } from './client'
export {
  DASHBOARD_NOT_FOUND_ERROR,
  type DashboardAuthoringTier,
  DIRTY_CANVAS_ERROR,
  NO_DASHBOARD_REF_ERROR,
  resolveDashboardAuthoring,
} from './tools/dashboard-authoring-guard'

const logger = createScopedLogger('dashboard-builder-capability')

/**
 * The draft mutation tools. The "read, build, and edit" bullet is only honest
 * while at least one of these survived runtime filtering.
 */
const WRITE_TOOL_NAMES = [
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
]

/**
 * Page capability for the dashboard builder
 * (`plans/dashboard/v3/02-kopilot-capability.md`). Mounts on the dashboard
 * page; the docked chat there passes `page='dashboard.builder'` and the
 * `dashboard` session ref, so every tool resolves its subject from
 * `findRef(ctx, 'dashboard')` and never takes a dashboard id.
 *
 * Thin wrappers over `dashboards/draft-edit/`. Permission checks live HERE
 * (`resolveDashboardAuthoring`), never in draft-edit.
 *
 * There is no `publish_dashboard`, `create_dashboard`, `discard_draft`,
 * `restore_version`, `delete_dashboard`, `archive`, `duplicate`, share/privacy
 * or `set_default` tool. ABSENT rather than gated, so there is no tool the model
 * can be tempted to try and be refused. Publishing in particular is a deliberate
 * human act: an agent that can publish removes the review step it exists to
 * produce work for.
 */
export function createDashboardBuilderCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: DASHBOARD_BUILDER_PAGE,
    tools: [
      // Discovery (progressive disclosure - the prompt carries no widget list).
      createListWidgetKindsTool(getDeps),
      createDescribeWidgetKindTool(getDeps),
      createListDashboardSourcesTool(getDeps),
      // Read
      createGetDashboardTool(getDeps),
      createGetWidgetTool(getDeps),
      // Write
      createAddWidgetTool(getDeps),
      createUpdateWidgetTool(getDeps),
      createChangeWidgetTypeTool(getDeps),
      createArrangeWidgetsTool(getDeps),
      createDeleteWidgetsTool(getDeps),
      createAddTabTool(getDeps),
      createUpdateTabTool(getDeps),
      createDeleteTabTool(getDeps),
      createSetGlobalFiltersTool(getDeps),
      createReplaceLayoutTool(getDeps),
      // Verify
      createPreviewWidgetTool(getDeps),
      createValidateDashboardTool(getDeps),
    ],
    systemPromptAddition: (ctx) => buildDashboardBuilderPromptSection(ctx),
    capabilities: ({ toolNames }) =>
      WRITE_TOOL_NAMES.some((name) => toolNames.has(name))
        ? ['Read, build, and edit the dashboard open on this page']
        : ['Read the dashboard open on this page'],
    lifecycle: {
      // A dashboard turn writes through a pre-turn snapshot: the first mutation
      // captures the prior layout doc in Redis (`draft-edit/turn-snapshot.ts`,
      // inside the shared mutation pipeline). Turn end has exactly ONE job -
      // `completed` discards the snapshot; every other outcome leaves it alone.
      // Revert is NEVER automatic: each mutation persisted independently,
      // through its own validation, its own hash-CAS and its own realtime
      // signal, so a turn that stopped early leaves N complete, valid edits the
      // user already watched land, not a corrupt half-write.
      async onTurnEnd(outcome, { turnId }) {
        const { sessionContext, organizationId } = getDeps()
        const dashboardId = findRef(sessionContext, 'dashboard')?.id
        if (!dashboardId) return

        // Release the canvas lock FIRST, and OUTSIDE the snapshot branch below.
        // A turn that read but never wrote has no snapshot yet still holds the
        // lock (it is claimed on the first tool call of any kind), so releasing
        // inside the `if (!snapshot)` path would strand the canvas read-only -
        // and, on a dashboard, keep its 800ms auto-save suspended - for the
        // whole of every question-only turn. Its own try/catch so a Redis
        // failure cannot stop the snapshot bookkeeping that follows. This
        // ordering holds for EVERY outcome.
        const { endDashboardTurnLock } = await import('../../../../dashboards/draft-edit/turn-lock')
        try {
          await endDashboardTurnLock(organizationId, dashboardId, turnId)
        } catch (err) {
          logger.error('Kopilot dashboard turn-lock release failed', {
            dashboardId,
            turnId,
            error: err instanceof Error ? err.message : String(err),
          })
        }

        try {
          // Lazy import - turn-snapshot pulls @auxx/redis and the persist seam;
          // neither belongs in this capability's import-time graph, and the
          // laziness keeps tests free to mock the module wholesale.
          // `revertDashboardTurn` is deliberately NOT imported here: the restore
          // is offered by the Undo card (tRPC), never performed by this hook.
          const { finalizeDashboardTurn, readDashboardTurnSnapshot, recordDashboardTurnEnding } =
            await import('../../../../dashboards/draft-edit/turn-snapshot')
          // Turn-checked, so this read IS the "did THIS turn write" record: a
          // prior turn's still-pending snapshot answers null here.
          const snapshot = await readDashboardTurnSnapshot(dashboardId, turnId)
          if (!snapshot) return
          if (outcome !== 'completed') {
            // The turn stopped early - KEEP the work AND the snapshot.
            //
            // Not reverting is the point: `exhausted` (token budget, iteration
            // cap, failure streak), `aborted` (page reload, navigate-away) and
            // even `error` all leave a draft that is N complete, individually
            // persisted mutations. A draft has no atomicity requirement to
            // protect - "half-finished" is what the canvas looks like every
            // time a human stops mid-thought.
            //
            // Not FINALIZING is just as load-bearing, and less obvious.
            // Finalizing DISCARDS the snapshot, which is the only recovery path
            // this turn has left, and it is exactly what the Undo card
            // consumes. `delete_widgets` carries no approval gate, so a turn
            // that deletes five widgets and then trips the budget leaves them
            // deleted; the snapshot is what makes that recoverable.
            //
            // Leaving it behind is safe, not a leak - do NOT "tidy this up":
            //  - the slot is one-per-dashboard (`dashboard:layout:<id>:preturn`)
            //  - the next turn's first write overwrites it
            //  - `readDashboardTurnSnapshot` is turn-checked, so a superseded
            //    caller reads null rather than a foreign turn's document
            //  - a manual canvas save clears it
            //  - Redis expires it after 24h
            //
            // Stamp HOW it ended before returning. This is the ONLY place the
            // ending is knowable and durable at once: the snapshot is a
            // document, not a transcript, so without this stamp the Undo offer
            // can only say "stopped early". Additive rather than a finalize: it
            // rewrites one field of the same slot, cannot delete it, is
            // turn-checked inside, and swallows its own failures, so a Redis
            // blip costs the adjective and never the offer.
            await recordDashboardTurnEnding(dashboardId, turnId, outcome)
            // Warn, not error: nothing is broken, but a turn that kept work it
            // did not finish is worth seeing in the logs.
            logger.warn('Kopilot dashboard turn stopped early - edits kept, snapshot retained', {
              dashboardId,
              turnId,
              outcome,
            })
            return
          }
          // The turn committed - discard its snapshot (turn-checked, so a
          // fresher turn's slot is never cleared). Keeping it would only leave a
          // stale revert target around; canvas history owns undo from here.
          await finalizeDashboardTurn(dashboardId, turnId)
        } catch (err) {
          logger.error('Kopilot turn-end dashboard lifecycle failed', {
            dashboardId,
            turnId,
            outcome,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
    },
  }
}
