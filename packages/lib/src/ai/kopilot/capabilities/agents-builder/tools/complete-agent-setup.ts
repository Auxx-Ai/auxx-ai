// packages/lib/src/ai/kopilot/capabilities/agents-builder/tools/complete-agent-setup.ts

import { completeAgentSetup } from '../../../../../agents/agent-service'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import { findRef } from '../../../context-refs'
import type { GetToolDeps } from '../../types'
import { buildAgentRailUpdate } from '../snapshot'

/**
 * Flip the agent's `setupCompletedAt` from null → now. Idempotent. The rail
 * UI swaps from the setup carousel to the Prompt/Tools/Knowledge tabs when
 * this lands. Persona prompt instructs the builder to call this as the LAST
 * thing in Step 3 (Onboarding), after prompt + toolsets + name are all set.
 */
export function createCompleteAgentSetupTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'complete_agent_setup',
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
      const { sessionContext } = getDeps()
      const agentRef = findRef(sessionContext, 'agent')
      if (!agentRef?.id) {
        return {
          success: false,
          output: null,
          error: 'No agent in session context — this tool only runs on the builder page.',
        }
      }

      await completeAgentSetup(agentRef.id, agentDeps.organizationId)

      return {
        success: true,
        output: {
          agentId: agentRef.id,
          ...buildAgentRailUpdate({
            agentId: agentRef.id,
            changed: ['identity'],
            summary: 'setup complete',
          }),
        },
      }
    },
  }
}
