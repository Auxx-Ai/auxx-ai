// packages/lib/src/ai/kopilot/prompts/sections/agent-persona.ts

import { docToText } from '../../../../tiptap'
import { buildAgentPersonaPrompt } from '../agent-persona-prompt'
import { ALL_MODES, type PromptSection } from './types'

/**
 * User-authored agent persona — rendered when the session is bound to a
 * non-master agent (`agentConfig.agentId !== null`).
 */
export const agentPersona: PromptSection = {
  id: 'agent-persona',
  modes: ALL_MODES,
  stability: 'org',
  render: (ctx) => {
    const cfg = ctx.agentConfig
    if (!cfg || cfg.agentId === null) return null
    return buildAgentPersonaPrompt({
      agentName: cfg.name,
      description: cfg.description ?? undefined,
      instructions: docToText(cfg.prompt, { references: ctx.instructionsReferences }),
    }).trim()
  },
}
