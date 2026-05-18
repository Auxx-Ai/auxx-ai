// packages/lib/src/ai/kopilot/prompts/sections/trigger-instructions.ts

import { renderTriggerInstructions } from '../trigger-context'
import { ALL_MODES, type PromptSection } from './types'

/**
 * "## Trigger instructions" — the operator's authored prose. Changes only
 * on admin edit, so tier 2.
 *
 * Renders in both autonomous and interactive (DM) modes — DM is the one
 * interactive run that still wants per-agent trigger instructions layered
 * in. The render gate is the presence of trigger-context instructions,
 * which is only set when a trigger row backs the run.
 */
export const triggerInstructions: PromptSection = {
  id: 'trigger-instructions',
  modes: ALL_MODES,
  stability: 'org',
  render: (ctx) => {
    const text = ctx.triggerContext?.instructions
    if (!text?.trim()) return null
    return renderTriggerInstructions(text)
  },
}
