// packages/lib/src/ai/kopilot/prompts/sections/trigger-instructions.ts

import { renderTriggerInstructions } from '../trigger-context'
import { AUTONOMOUS_ONLY, type PromptSection } from './types'

/**
 * "## Trigger instructions" — the operator's authored prose. Changes only
 * on admin edit, so tier 2.
 */
export const triggerInstructions: PromptSection = {
  id: 'trigger-instructions',
  modes: AUTONOMOUS_ONLY,
  stability: 'org',
  render: (ctx) => {
    const text = ctx.triggerContext?.instructions
    if (!text?.trim()) return null
    return renderTriggerInstructions(text)
  },
}
