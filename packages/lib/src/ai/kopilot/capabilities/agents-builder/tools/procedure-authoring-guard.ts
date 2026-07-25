// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/procedure-authoring-guard.ts

import { FeaturePermissionService } from '../../../../../permissions'
import { FeatureKey } from '../../../../../permissions/client'
import type { AgentDeps } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { type AgentAuthoringResolution, resolveAgentAuthoring } from './agent-authoring-guard'

/**
 * Authorization for the procedure- and eval-authoring tools (Phase 7 §4.0).
 *
 * The OWNER/ADMIN + org-scope core lives in `resolveAgentAuthoring` — shared
 * with the identity/prompt/toolset/trigger/scope setters so a new builder tool
 * cannot pick up a weaker check. This wrapper adds the one thing that is
 * specific to procedures and evals: the `agentProcedures` beta feature must be
 * on the org's plan.
 *
 * Plan gating runs AFTER authorization on purpose — a non-admin must be told
 * they are not allowed, not that the workspace lacks a feature.
 */
export async function resolveProcedureAuthoring(
  getDeps: GetToolDeps,
  agentDeps: AgentDeps
): Promise<AgentAuthoringResolution> {
  const resolved = await resolveAgentAuthoring(getDeps, agentDeps)
  if (!resolved.ok) return resolved

  try {
    await new FeaturePermissionService().requireAccess(
      agentDeps.organizationId,
      FeatureKey.agentProcedures
    )
  } catch {
    return { ok: false, error: 'Agent procedures are not available on this workspace’s plan.' }
  }

  return resolved
}
