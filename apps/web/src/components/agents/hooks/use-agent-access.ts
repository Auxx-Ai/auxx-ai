// apps/web/src/components/agents/hooks/use-agent-access.ts
'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { toRecordId } from '@auxx/types/resource'
import { useMemo } from 'react'
import { useAccess } from '~/providers/capabilities-provider'

/** The three per-agent rungs plus the coarse "may create an agent" gate. */
export interface AgentAccess {
  /** `view` — *usable*: open the detail page read-only, chat, DM, @-mention, assign work. */
  canView: boolean
  /** `edit` — prompt, drafts, toolsets, bindings, knowledge scope, procedures, evals. */
  canEdit: boolean
  /** `admin` — publish, restore, delete, archive, rename, run-as, permission profile, triggers. */
  canAdmin: boolean
  /** Coarse `agents.manage` — creating a NEW agent is not per-instance. */
  canCreate: boolean
}

/**
 * Per-agent instance access for the client (plan 25 §4.2.DECIDED) — the agent
 * twin of {@link import('~/components/workflow/hooks/use-workflow-access').useWorkflowAccess},
 * keyed by `Agent.id`.
 *
 * Tiers (user decision 2026-07-27/28): **`view` means the agent is USABLE** —
 * chat with it in Kopilot, DM it, @-mention it, assign it work, see it in actor
 * pickers. It does *not* mean "can author it". Every coarse gate that decides
 * whether a member reaches the agents list/detail at all must therefore read
 * `canView` (i.e. `agents.view`), never `agents.manage` — #1346 shipped exactly
 * that bug for workflows by leaving the sidebar and cmd+K on `.manage`.
 *
 * This is the TRANSPOSE of *agent policy* (`AgentPermissionsSection`, the
 * `agent-policy-*` grids): policy is what the AGENT may do when it runs, this is
 * what USERS may do to the agent. The two render as similar grids — keep the
 * copy apart.
 *
 * With no id resolved yet (the detail page routes by slug and mounts before the
 * agent loads) this falls back to the coarse `Area.agents` rungs. That is not a
 * guess: agents are `baselineAtCreate: false`, so an agent with no explicit
 * `ResourceAccess` row resolves to exactly the area level anyway — the fallback
 * and the per-instance answer agree for every unrestricted agent, and only a
 * restricted one flips once its id arrives.
 *
 * Server enforcement is the source of truth (`~/server/lib/agent-instance-access`);
 * this is degrade-only, to avoid rendering affordances that 403.
 *
 * MUST be called inside `CapabilitiesProvider` — i.e. only from `(protected)`
 * surfaces. Visitor/widget chat has no capability context and is deliberately
 * excluded from agent instance access altogether.
 *
 * @param agentId The `Agent.id`. Pass `null`/`undefined` before it resolves —
 *   never a slug, which matches no `ResourceAccess` row.
 */
export function useAgentAccess(agentId?: string | null): AgentAccess {
  const { can, canViewInstance, canEditInstance, canAdminInstance } = useAccess()

  return useMemo(() => {
    const canCreate = can(PermissionKey.agentsManage)
    if (!agentId) {
      return {
        canView: can(PermissionKey.agentsView),
        canEdit: can(PermissionKey.agentsEdit),
        canAdmin: canCreate,
        canCreate,
      }
    }
    const recordId = toRecordId('agent', agentId)
    return {
      canView: canViewInstance(recordId),
      canEdit: canEditInstance(recordId),
      canAdmin: canAdminInstance(recordId),
      canCreate,
    }
  }, [agentId, can, canViewInstance, canEditInstance, canAdminInstance])
}
