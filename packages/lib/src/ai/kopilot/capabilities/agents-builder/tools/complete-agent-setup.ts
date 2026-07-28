// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/complete-agent-setup.ts

import { completeAgentSetup } from '../../../../../agents/agent-service'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveAgentAuthoring } from './agent-authoring-guard'

/**
 * Flip the agent's `setupCompletedAt` from null → now. Idempotent. The rail
 * UI swaps from the setup carousel to the Prompt/Tools/Knowledge tabs when
 * this lands. Persona prompt instructs the builder to call this as the LAST
 * thing in Step 3 (Onboarding), after prompt + toolsets + name are all set.
 */
export function createCompleteAgentSetupTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'complete_agent_setup',
    permission: {
      target: 'area',
      area: 'agents',
      level: 'admin',
      enforcement: 'enforced',
      note: 'resolveAgentAuthoring — PermissionKey.agentsManage (the agents area’s only rung) on the caller’s own CapabilitySet, plus an org-scope check on the session agent ref. Enforcement is proven behaviourally by agents-builder/tools/__tests__/agent-authoring-guard.test.ts.',
    },
    displayName: 'Complete agent setup',
    // Builder-only meta-tool. See plans/chat/v6/chat-tool-availability.md.
    surfaces: ['builder'],
    description: `Mark this agent's chat-driven setup as complete.

Call this as the LAST step of the three-phase build, after:
- the agent has a real name (you have called \`update_agent_identity\` with a name)
- the persona prompt is non-empty (you have called \`set_agent_prompt\`)
- at least one toolset is enabled (you have called \`set_agent_toolsets\`)

Calling this flips the rail UI from the setup carousel to the live editing
tabs. The agent is functionally live the whole time; this is purely a
finalization signal. No arguments — operates on the agent in session context.`,
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async (_args, agentDeps) => {
      const auth = await resolveAgentAuthoring(getDeps, agentDeps, 'admin')
      if (!auth.ok) return { success: false, output: null, error: auth.error }
      const { agentId } = auth

      try {
        // The acting human bounds v1's published permission policy (§2.4a) — a
        // builder-driven setup must not mint more authority than its author holds.
        await completeAgentSetup(agentId, agentDeps.organizationId, undefined, {
          completedByUserId: agentDeps.userId,
        })
      } catch (err) {
        // Surface server-side preconditions (empty prompt / missing toolset
        // / missing name) as a tool error so the model can fix the gap
        // instead of erroring out the turn.
        return {
          success: false,
          output: null,
          error: err instanceof Error ? err.message : String(err),
        }
      }

      return {
        success: true,
        output: {
          agentId,
        },
      }
    },
  }
}
