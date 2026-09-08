// packages/lib/src/ai/kopilot/capabilities/dashboard-builder/tools/dashboard-authoring-guard.ts

import { schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { ForbiddenError } from '../../../../../errors'
import { PermissionKey } from '../../../../../permissions/capabilities/registry'
import type { AgentDeps } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'

/**
 * Refusal text for "this tool ran without a builder session". Shared so the
 * enumeration test can assert on the AUTHORIZATION path without matching a
 * per-tool message.
 */
export const NO_DASHBOARD_REF_ERROR =
  'No dashboard in session context - this tool only runs on the dashboard page.'

/**
 * Silent-read refusal: a dashboard the principal may not view - foreign org,
 * instance-restricted, or archived - reads as "not found", never as a 403 that
 * confirms it exists.
 */
export const DASHBOARD_NOT_FOUND_ERROR = 'Dashboard not found in this workspace.'

/**
 * The dirty-canvas refusal. Actionable: the model relays it, the user saves or
 * discards, then retries.
 */
export const DIRTY_CANVAS_ERROR =
  'The dashboard canvas has unsaved changes, so editing the stored draft now would conflict with ' +
  'what the user sees. Ask the user to save (or discard) their canvas changes first, then retry.'

export type DashboardAuthoringResolution =
  | { ok: true; dashboardId: string }
  | { ok: false; error: string }

/**
 * Which access rung a dashboard-builder tool needs. Mirrors the tRPC ladder in
 * `apps/web/src/server/api/routers/dashboard.ts`: the AREA key is
 * `dashboardsView` everywhere (a dashboard is an instance-access resource, so
 * the per-dashboard rung is what varies), and the instance rung is `view` for
 * reads vs `edit` for every draft mutation.
 *
 * NO DEFAULT, on purpose: a shared gate with a hardcoded tier is how a Kopilot
 * tool ends up cheaper than the router it mirrors. `admin` is unused by any tool
 * today and stays in the union so a future settings tool cannot quietly land at
 * `edit`.
 */
export type DashboardAuthoringTier = 'view' | 'edit' | 'admin'

/**
 * **The** authorization gate for every tool in the `dashboard.builder`
 * capability set.
 *
 * THREAT MODEL, restated because it is the reason this file exists: these tools
 * run BELOW the tRPC routers, reached through `POST /api/kopilot/stream` - a
 * route that authenticates the session but takes `page` and `context` straight
 * off the REQUEST BODY. Any authenticated member can POST
 * `page: 'dashboard.builder'` with a crafted `dashboard` ref, so each tool
 * re-asserts everything the router would:
 *
 * 1. **Fail closed on absent capabilities.** The documented lib-wide convention
 *    is `capabilities === undefined` implies UNRESTRICTED (the workflow AI node
 *    is the un-threaded caller). For dashboard writes that default is wrong, and
 *    this capability only ever mounts on a real user session, so a missing view
 *    is refused outright rather than waved through. This is DELIBERATELY the
 *    opposite of the convention; do not "fix" it back.
 * 2. **The area rung** - `PermissionKey.dashboardsView`, exact parity with the
 *    router base (every procedure there is a `capabilityProcedure` and the
 *    per-instance rung is what varies).
 * 3. **Org scope.** The id arrives in client-supplied session refs, so it is
 *    verified against THIS org before any instance assert: a foreign id must
 *    read as "not in this workspace" rather than leak that it exists elsewhere.
 * 4. **Per-dashboard instance rung** - `canViewInstance` (silent, returns
 *    not-found) for reads, `assertEditInstance` / `assertAdminInstance` (throws
 *    `ForbiddenError`) for mutations.
 * 5. **Archived reads as not-found.** The scope query filters
 *    `archivedAt IS NULL`, matching `loadDashboardRow`. There is NO dashboard
 *    analogue of the workflow ladder's `assertWorkflowAppNotSystemOwned` (no
 *    dashboard is system-owned), so that rung simply does not exist here - said
 *    out loud rather than leaving a reader wondering what was dropped.
 * 6. **The dirty gate** (mutations only, LAST so a permission denial is never
 *    masked by it): the builder chip contributes `{ id, isDirty }` and a
 *    mutation refuses while it is true. Advisory and may be absent - the
 *    hash-CAS inside `draft-edit/persist.ts` is the real concurrency guard.
 * 7. **The canvas turn lock**, claimed on the FIRST tool call of ANY kind,
 *    reads included. Locking only on the first MUTATION would leave exactly the
 *    window this closes: the dirty gate reads `isDirty` off the session ref
 *    captured when the message was SENT, so a user who dirties the canvas after
 *    send but before the first write is invisible to it. On a dashboard the lock
 *    has a second job the workflow one never had - it SUSPENDS the 800ms
 *    auto-save, which would otherwise flush a pre-turn document over everything
 *    the agent wrote. Claimed after every authorization check, so an
 *    unauthorized caller can never move the lock (and therefore can never freeze
 *    another member's canvas by POSTing a crafted ref).
 *
 * Authorization failures **throw `ForbiddenError`** (auditable; the engine turns
 * it into a `tool-call-failed` event). Bad-context conditions - missing ref,
 * silent read filtering, the dirty gate - come back `{ ok: false }` so the model
 * gets a plain, actionable tool error it can relay.
 */
export async function resolveDashboardAuthoring(
  getDeps: GetToolDeps,
  agentDeps: AgentDeps,
  tier: DashboardAuthoringTier,
  opts: { mutation?: boolean } = {}
): Promise<DashboardAuthoringResolution> {
  const { db, sessionContext, capabilities } = getDeps()
  const dashboardRef = findRef(sessionContext, 'dashboard')
  if (!dashboardRef?.id) {
    return { ok: false, error: NO_DASHBOARD_REF_ERROR }
  }
  const dashboardId = dashboardRef.id
  const organizationId = agentDeps.organizationId

  // (1) Fail closed. Deliberately opposite the lib-wide
  // `undefined implies unrestricted` convention - see the docblock.
  if (!capabilities) {
    throw new ForbiddenError(
      'This session carries no permission context - dashboard editing is unavailable.'
    )
  }
  // (2) Area rung.
  if (!capabilities.can(PermissionKey.dashboardsView)) {
    throw new ForbiddenError('You do not have permission to work with dashboards.')
  }

  // (3) Org scope + (5) the archived check, in one query. An archived dashboard
  // reads as not-found, matching `loadDashboardRow`.
  const [row] = await db
    .select({ id: schema.Dashboard.id })
    .from(schema.Dashboard)
    .where(
      and(
        eq(schema.Dashboard.id, dashboardId),
        eq(schema.Dashboard.organizationId, organizationId),
        isNull(schema.Dashboard.archivedAt)
      )
    )
    .limit(1)
  if (!row) {
    if (tier === 'view') return { ok: false, error: DASHBOARD_NOT_FOUND_ERROR }
    throw new ForbiddenError(DASHBOARD_NOT_FOUND_ERROR)
  }

  // (4) Per-dashboard instance rung. Reads filter silently, writes throw.
  if (tier === 'view') {
    if (!capabilities.canViewInstance('dashboard', dashboardId)) {
      return { ok: false, error: DASHBOARD_NOT_FOUND_ERROR }
    }
  } else if (tier === 'edit') {
    capabilities.assertEditInstance('dashboard', dashboardId)
  } else {
    capabilities.assertAdminInstance('dashboard', dashboardId)
  }

  // (6) Dirty gate - advisory, mutations only, after every real check.
  if (opts.mutation && dashboardRef.isDirty === true) {
    return { ok: false, error: DIRTY_CANVAS_ERROR }
  }

  // (7) Canvas turn lock. Lazy import: `turn-lock` pulls @auxx/redis and the
  // realtime barrel, neither of which belongs in this capability's import-time
  // graph. Non-blocking by construction (the lock fails open).
  if (agentDeps.turnId) {
    const { beginDashboardTurnLock } = await import(
      '../../../../../dashboards/draft-edit/turn-lock'
    )
    await beginDashboardTurnLock(organizationId, dashboardId, agentDeps.turnId)
  }

  return { ok: true, dashboardId }
}
