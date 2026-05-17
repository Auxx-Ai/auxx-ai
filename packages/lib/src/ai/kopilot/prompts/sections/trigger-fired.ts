// packages/lib/src/ai/kopilot/prompts/sections/trigger-fired.ts

import { renderTriggerKindBlock } from '../trigger-context'
import { AUTONOMOUS_ONLY, type PromptSection } from './types'

/**
 * Per-turn trigger payload — kind, ids, timestamps. Rebuilt on every fire,
 * so this is the only trigger-related section in tier 3.
 */
export const triggerFired: PromptSection = {
  id: 'trigger-fired',
  modes: AUTONOMOUS_ONLY,
  stability: 'turn',
  render: (ctx) => {
    if (!ctx.triggerContext) return null
    return renderTriggerKindBlock(ctx.triggerContext)
  },
}
