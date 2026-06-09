// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/procedure-authoring-guard.ts

import { getCachedAgentById } from '../../../../../cache'
import { isAdminOrOwner } from '../../../../../members'
import { FeaturePermissionService } from '../../../../../permissions'
import { FeatureKey } from '../../../../../permissions/client'
import type { AgentDeps } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'

/**
 * Shared authorization for the procedure-authoring tools (Phase 7 §4.0). The
 * tools run BELOW the tRPC router, so they must re-assert the builder page's
 * contract themselves: the `agentProcedures` beta feature must be on the plan,
 * and the session user must be able to administer agents. One guard, four tools.
 */
export async function resolveProcedureAuthoring(
  getDeps: GetToolDeps,
  agentDeps: AgentDeps
): Promise<{ ok: true; agentId: string } | { ok: false; error: string }> {
  const { sessionContext } = getDeps()
  const agentRef = findRef(sessionContext, 'agent')
  if (!agentRef?.id) {
    return {
      ok: false,
      error: 'No agent in session context — this tool only runs on the builder page.',
    }
  }

  try {
    await new FeaturePermissionService().requireAccess(
      agentDeps.organizationId,
      FeatureKey.agentProcedures
    )
  } catch {
    return { ok: false, error: 'Agent procedures are not available on this workspace’s plan.' }
  }

  const admin = await isAdminOrOwner(agentDeps.organizationId, agentDeps.userId)
  if (!admin) {
    return { ok: false, error: 'Only an admin or owner can author procedures.' }
  }

  // The agent id comes from client-supplied session refs — verify it belongs to
  // THIS org before any tool acts on it. The read/edit paths are also guarded by
  // the org-scoped AgentProcedure filter, but `create_procedure` attaches a new
  // link, so without this check it could attach to another org's agent.
  const agent = await getCachedAgentById(agentDeps.organizationId, agentRef.id)
  if (!agent) {
    return { ok: false, error: 'Agent not found in this workspace.' }
  }

  return { ok: true, agentId: agentRef.id }
}
