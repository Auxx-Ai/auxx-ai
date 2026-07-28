// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/agent-authoring-guard.ts

import { type CachedAgent, getCachedAgentById } from '../../../../../cache'
import { ForbiddenError } from '../../../../../errors'
import { getCapabilities } from '../../../../../permissions/capabilities/get-capabilities'
import { PermissionKey } from '../../../../../permissions/capabilities/registry'
import type { AgentDeps } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'

/**
 * Refusal text for "this tool ran without a builder session". Shared so the
 * enumeration test can assert on the *authorization* path without matching a
 * per-tool message.
 */
export const NO_AGENT_REF_ERROR =
  'No agent in session context — this tool only runs on the builder page.'

export type AgentAuthoringResolution =
  | { ok: true; agentId: string; agent: CachedAgent }
  | { ok: false; error: string }

/**
 * Which per-agent tier a builder tool needs. Mirrors the tRPC ladder exactly —
 * see the tier table on {@link resolveAgentAuthoring}.
 *
 * There is no default on purpose. A shared gate with a single hardcoded tier is
 * how a Kopilot tool ends up cheaper than the router it mirrors, which is the
 * bypass this parameter exists to prevent: `set_agent_triggers` is `admin` on
 * the tRPC side, so it must not be reachable at `edit` through chat.
 */
export type AgentAuthoringTier = 'view' | 'edit' | 'admin'

/**
 * **The** authorization gate for every agent-authoring meta-tool in the
 * `agents.builder` capability set (prompt, toolsets, triggers, resource scope,
 * identity, setup completion, procedures, evals).
 *
 * These tools run BELOW the tRPC routers, reached through
 * `POST /api/kopilot/stream` — a route that authenticates the session but takes
 * `page` and `context` straight off the request body. Nothing upstream re-asserts
 * the builder page's contract, so each tool must: any authenticated member could
 * otherwise POST `page: 'agents.builder'` with a crafted `agent` ref and rewrite
 * an arbitrary agent's prompt / toolsets / triggers / scope. `set_agent_toolsets`
 * in particular is the self-rewriting-boundary case
 * `plans/permissions/v2/19-permission-profiles.md` §0 forbids.
 *
 * Three checks, one code path:
 * 1. **The area rung for `tier`** — exact parity with the procedure in
 *    `apps/web/src/server/api/routers/agent.ts` that each tool is the
 *    Kopilot-side twin of.
 *
 *    This was deliberately stricter (OWNER/ADMIN) until plan 19 step 3, and the
 *    reason is worth recording: while the seeded `agent` profile was all-`Full`
 *    and nothing clamped a publish, `agentsManage` WAS an escalation path — a
 *    member holding only that key could mint an all-`Full` non-human principal
 *    and invoke it. The OWNER/ADMIN gate here was a stopgap around that hole. The
 *    §2.4a **author clamp** now closes it at the real choke point: a published
 *    agent can never exceed the human who published it, so an `agentsManage`
 *    holder authoring an agent can only ever produce a principal bounded by their
 *    own authority. Keeping these tools permanently stricter than the tRPC path
 *    they mirror would just mean the Kopilot builder refuses work the same user
 *    can do one click away in the UI (§5.3's "the editor would be lying", in
 *    reverse).
 *
 *    Editing an agent's *permission profile* remains OWNER/ADMIN-only (plan 19
 *    §6) — that is a governance action, and no tool here performs it.
 * 2. **Org scope** — the agent id arrives in client-supplied session refs, and
 *    `updateAgent` / the toolset+trigger+scope services key on `Agent.id`
 *    without an org predicate, so an unscoped ref is a cross-tenant write.
 * 3. **Per-agent instance access** (plan 25 §4.2, 2026-07-28). Agents joined
 *    `INSTANCE_ACCESS_RESOURCES`, and check 1 is a COARSE key — it answers "may
 *    this member author agents at all", never "may they author THIS one". Without
 *    this third check a member holding `agents: Full` with an explicit `none` row
 *    on one agent sails straight through and rewrites it through chat, which is
 *    the standing "requirePermission is coarse-key only" trap applied to the
 *    tool layer. The tier table:
 *
 *    | tool                                                       | tier  |
 *    |------------------------------------------------------------|-------|
 *    | `get_eval_case`, `get_eval_run`, `get_suite_diff`,          | view  |
 *    | `list_eval_cases`, `procedure_read`                         |       |
 *    | `set_agent_prompt`, `set_agent_toolsets`,                   | edit  |
 *    | `set_agent_resource_scope`, `create_eval_case`,             |       |
 *    | `update_eval_case_mock`, `run_eval_suite`,                  |       |
 *    | `procedure_create`, `procedure_set_body`,                   |       |
 *    | `procedure_update_criteria`                                 |       |
 *    | `set_agent_triggers`, `update_agent_identity`,              | admin |
 *    | `complete_agent_setup`                                      |       |
 *
 *    `set_agent_triggers` is `admin` because a trigger makes the agent act
 *    autonomously on its own credentials (user decision 2026-07-28), matching
 *    `agent-trigger.ts`. `update_agent_identity` renames, and
 *    `complete_agent_setup` finalizes — both admin on the tRPC side.
 *
 * Authorization failures **throw `ForbiddenError`** (an `AuxxError`; lib code
 * never throws `TRPCError`). The engine turns a thrown tool error into a
 * `tool-call-failed` event and logs it at error level, so the turn survives and
 * the denial is auditable. The only non-throwing outcome is the missing
 * `agent` ref, which is a bad-context condition rather than a denial — it comes
 * back as `{ ok: false }` so the model gets a plain tool error.
 */
export async function resolveAgentAuthoring(
  getDeps: GetToolDeps,
  agentDeps: AgentDeps,
  tier: AgentAuthoringTier
): Promise<AgentAuthoringResolution> {
  const { sessionContext } = getDeps()
  const agentRef = findRef(sessionContext, 'agent')
  if (!agentRef?.id) {
    return { ok: false, error: NO_AGENT_REF_ERROR }
  }

  const caps = await getCapabilities(agentDeps.userId, agentDeps.organizationId)
  if (!caps.can(AREA_KEY_FOR_TIER[tier])) {
    throw new ForbiddenError('You don’t have permission to configure agents.')
  }

  // The agent id comes from client-supplied session refs — verify it belongs to
  // THIS org before any tool acts on it. `getCachedAgentById` reads the org's
  // own `agents` cache entry, so a foreign id simply isn't there.
  const agent = await getCachedAgentById(agentDeps.organizationId, agentRef.id)
  if (!agent) {
    throw new ForbiddenError('Agent not found in this workspace.')
  }

  // Per-agent tier. Runs AFTER the org-scope check so a foreign id reads as
  // "not in this workspace" rather than leaking that it exists elsewhere.
  // `agentRef.id` is a real `Agent.id` here — `getCachedAgentById` matched it,
  // and it is keyed by id, not slug — so it is safe to assert on directly.
  ASSERT_FOR_TIER[tier](caps, agentRef.id)

  return { ok: true, agentId: agentRef.id, agent }
}

/** The coarse area rung each tier requires, before the per-instance check. */
const AREA_KEY_FOR_TIER: Record<AgentAuthoringTier, PermissionKey> = {
  view: PermissionKey.agentsView,
  edit: PermissionKey.agentsEdit,
  admin: PermissionKey.agentsManage,
}

/** The per-instance assert each tier runs. Throws `ForbiddenError` on denial. */
const ASSERT_FOR_TIER: Record<
  AgentAuthoringTier,
  (caps: Awaited<ReturnType<typeof getCapabilities>>, agentId: string) => void
> = {
  view: (caps, agentId) => caps.assertViewInstance('agent', agentId),
  edit: (caps, agentId) => caps.assertEditInstance('agent', agentId),
  admin: (caps, agentId) => caps.assertAdminInstance('agent', agentId),
}
