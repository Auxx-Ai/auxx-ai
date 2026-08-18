// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/workflow-authoring-guard.ts

import { schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { ForbiddenError } from '../../../../../errors'
import type { CapabilityView } from '../../../../../permissions/capabilities/capability-view'
import { PermissionKey } from '../../../../../permissions/capabilities/registry'
import { beginWorkflowTurnLock } from '../../../../../workflows/graph-edit/turn-lock'
import { assertWorkflowAppNotSystemOwned } from '../../../../../workflows/workflow-app-access-guard'
import type { AgentDeps } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'

/**
 * Refusal text for "this tool ran without a builder session". Shared so the
 * enumeration test can assert on the *authorization* path without matching a
 * per-tool message.
 */
export const NO_WORKFLOW_REF_ERROR =
  'No workflow in session context — this tool only runs on the workflow builder page.'

/**
 * Silent-read refusal (`kb-access.ts` semantics): a workflow the principal may
 * not view — foreign org, instance-restricted, or system-owned — reads as "not
 * found", never as a 403 that confirms it exists.
 */
export const WORKFLOW_NOT_FOUND_ERROR = 'Workflow not found in this workspace.'

/**
 * The dirty-canvas refusal (Phase 3 §7). Actionable: the model relays it and
 * the user saves or discards, then retries.
 */
export const DIRTY_CANVAS_ERROR =
  'The canvas has unsaved changes, so editing the stored draft now would conflict with what the ' +
  'user sees. Ask the user to save (or discard) their canvas changes first, then retry.'

export type WorkflowAuthoringResolution =
  | { ok: true; workflowAppId: string }
  | { ok: false; error: string }

/**
 * Which access rung a workflow-builder tool needs. Mirrors the tRPC ladder in
 * `apps/web/src/server/api/routers/workflow.ts` exactly: the AREA key is
 * `workflowsView` everywhere (workflows are an instance-access resource — the
 * per-workflow rung is what varies), and the instance rung is `view` for reads
 * vs `edit` for every draft mutation and `runSingleNode`. No default on
 * purpose — a shared gate with a hardcoded tier is how a Kopilot tool ends up
 * cheaper than the router it mirrors.
 */
export type WorkflowAuthoringTier = 'view' | 'edit' | 'admin'

/**
 * Rungs (1) and (2) of {@link resolveWorkflowAuthoring}, on their own: fail
 * closed on absent capabilities, then the `workflowsView` area key.
 *
 * Extracted so the CATALOG tools — the ones that answer "what node types exist
 * and what config do they take" — can assert the area without the rest of the
 * ladder. They have no workflow instance to gate on: they take a type id, not a
 * ref, and requiring a session workflow would make them unusable off the
 * builder page for no security gain. Everything instance-shaped (org scope, the
 * per-workflow rung, system-owned lockdown, the dirty gate, the turn lock)
 * stays below, where a workflow id actually exists.
 *
 * It is a function rather than two copied `if`s so the fail-closed decision has
 * exactly ONE definition. Throws `ForbiddenError` on both rungs, same as the
 * full gate.
 *
 * Declared as an assertion signature, not `void`: extracting the null check out
 * of {@link resolveWorkflowAuthoring} would otherwise cost it the narrowing it
 * used to get from the inline `if`, and every later `capabilities.` call below
 * would need a non-null assertion — turning a refactor into three new places
 * where a future edit could silently deref undefined.
 */
export function assertWorkflowAreaAccess(
  capabilities: CapabilityView | undefined
): asserts capabilities is CapabilityView {
  if (!capabilities) {
    throw new ForbiddenError(
      'This session carries no permission context — workflow editing is unavailable.'
    )
  }
  if (!capabilities.can(PermissionKey.workflowsView)) {
    throw new ForbiddenError('You don’t have permission to work with workflows.')
  }
}

/**
 * **The** authorization gate for every graph tool in the `workflow.builder`
 * capability set.
 *
 * Threat model (same as `agent-authoring-guard.ts`): these tools run BELOW the
 * tRPC routers, reached through `POST /api/kopilot/stream` — a route that
 * authenticates the session but takes `page` and `context` straight off the
 * request body. Any authenticated member could POST `page: 'workflow.builder'`
 * with a crafted `workflow` ref, so each tool re-asserts:
 *
 * 1. **Fail closed on absent capabilities** (07 §5). The documented lib-wide
 *    convention is `capabilities === undefined ⇒ unrestricted` (the workflow AI
 *    node is the un-threaded caller) — for graph WRITES that default is wrong,
 *    and this capability is only ever mounted on a real user session, so a
 *    missing view is refused outright rather than waved through.
 * 2. **The area rung** — `PermissionKey.workflowsView`, exact parity with the
 *    router base (`permissionProcedure(workflowsView)` everywhere the instance
 *    rung varies).
 * 3. **Org scope** — the workflow id arrives in client-supplied session refs;
 *    a foreign id must read as "not in this workspace", never leak existence.
 * 4. **Per-workflow instance rung** — `canViewInstance` (silent) for reads,
 *    `assertEditInstance` / `assertAdminInstance` (throws `ForbiddenError`) for writes; plan 30's
 *    per-workflow `ResourceAccess` rows.
 * 5. **`assertWorkflowAppNotSystemOwned`** — every workflow router procedure
 *    applies it (sequences compile to hidden system-owned apps), so the
 *    capability must too. Reads stay blind to such rows (silent not-found).
 * 6. **The dirty gate** (mutations only, LAST so a permission denial is never
 *    masked): the builder chip contributes `{ id, isDirty }`; a mutation
 *    refuses while `isDirty` with an actionable message. The flag is advisory
 *    and may be absent — the hash-CAS inside graph-edit is the real guard.
 *
 * Authorization failures **throw `ForbiddenError`** (auditable; the engine
 * turns it into a `tool-call-failed` event). Bad-context conditions — missing
 * ref, silent read filtering, the dirty gate — come back `{ ok: false }` so
 * the model gets a plain, actionable tool error.
 */
export async function resolveWorkflowAuthoring(
  getDeps: GetToolDeps,
  agentDeps: AgentDeps,
  tier: WorkflowAuthoringTier,
  opts: { mutation?: boolean } = {}
): Promise<WorkflowAuthoringResolution> {
  const { db, sessionContext, capabilities } = getDeps()
  const workflowRef = findRef(sessionContext, 'workflow')
  if (!workflowRef?.id) {
    return { ok: false, error: NO_WORKFLOW_REF_ERROR }
  }
  const workflowAppId = workflowRef.id
  const organizationId = agentDeps.organizationId

  // (1) Fail closed — see the docblock. Deliberately opposite the lib-wide
  // `undefined ⇒ unrestricted` convention, so it is stated loudly there.
  // (2) Area rung. Both live in `assertWorkflowAreaAccess` so the catalog tools
  // share this exact decision rather than reimplementing it.
  assertWorkflowAreaAccess(capabilities)

  // (3) Org scope. The id comes from client-supplied session refs — verify it
  // belongs to THIS org before any instance assert, so a foreign id reads as
  // "not in this workspace" rather than leaking that it exists elsewhere.
  const [row] = await db
    .select({ id: schema.WorkflowApp.id })
    .from(schema.WorkflowApp)
    .where(
      and(
        eq(schema.WorkflowApp.id, workflowAppId),
        eq(schema.WorkflowApp.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!row) {
    if (tier === 'view') return { ok: false, error: WORKFLOW_NOT_FOUND_ERROR }
    throw new ForbiddenError(WORKFLOW_NOT_FOUND_ERROR)
  }

  // (4) Per-workflow instance rung. Reads filter silently; writes throw.
  if (tier === 'view') {
    if (!capabilities.canViewInstance('workflow', workflowAppId)) {
      return { ok: false, error: WORKFLOW_NOT_FOUND_ERROR }
    }
  } else if (tier === 'edit') {
    capabilities.assertEditInstance('workflow', workflowAppId)
  } else {
    capabilities.assertAdminInstance('workflow', workflowAppId)
  }

  // (5) System-owned lockdown — reads stay blind, writes get the guard's own
  // ForbiddenError verbatim.
  try {
    await assertWorkflowAppNotSystemOwned(db, { workflowAppId, organizationId })
  } catch (error) {
    if (tier === 'view' && error instanceof ForbiddenError) {
      return { ok: false, error: WORKFLOW_NOT_FOUND_ERROR }
    }
    throw error
  }

  // (6) Dirty gate — advisory, mutations only, after every real check.
  if (opts.mutation && workflowRef.isDirty === true) {
    return { ok: false, error: DIRTY_CANVAS_ERROR }
  }

  // (7) Canvas edit lock. Claimed on the FIRST tool call of the turn — reads
  // included, deliberately. Locking only on the first *mutation* would leave
  // the exact window this closes: the dirty gate above reads `isDirty` off the
  // session ref captured when the message was SENT, so a user who dirties the
  // canvas after send but before the first write is invisible to it, the
  // mutation proceeds, and the builder then drops the rest of the turn's
  // refresh events. The cost is that a pure read turn also locks; the pill
  // wording ("working" vs "editing") is what stays honest about that.
  //
  // After every authorization check so an unauthorized caller can never move
  // the lock, and non-blocking: a lock failure must not fail the tool.
  if (agentDeps.turnId) {
    await beginWorkflowTurnLock(organizationId, workflowAppId, agentDeps.turnId)
  }

  return { ok: true, workflowAppId }
}
