// packages/lib/src/ai/kopilot/prompts/sections/trigger-acting-as.ts

import { renderTriggerActingAs } from '../trigger-context'
import { AUTONOMOUS_ONLY, type PromptSection } from './types'

/**
 * "## Acting as" — surfaces the agent's actor id for ownership/assignment.
 * The id is stable per-agent (set at agent creation), so this is tier 2.
 */
export const triggerActingAs: PromptSection = {
  id: 'trigger-acting-as',
  modes: AUTONOMOUS_ONLY,
  stability: 'org',
  render: (ctx) => {
    if (!ctx.triggerContext) return null
    const userId = ctx.agentConfig?.userId
    if (!userId) return null
    return renderTriggerActingAs(userId)
  },
}
