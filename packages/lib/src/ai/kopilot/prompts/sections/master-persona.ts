// packages/lib/src/ai/kopilot/prompts/sections/master-persona.ts

import { KOPILOT_MASTER_IDENTITY } from '../kopilot-master-persona'
import { ALL_MODES, type PromptSection } from './types'

/**
 * Master Kopilot identity line. Tier-1 static so it caches across every
 * org and every turn. Per-org capabilities go in `master-capabilities`;
 * scope guard ("Stay on task") moved to the shared `house-rules` section.
 */
export const masterPersona: PromptSection = {
  id: 'master-persona',
  modes: ALL_MODES,
  stability: 'static',
  render: (ctx) => {
    if (ctx.agentConfig && ctx.agentConfig.agentId !== null) return null
    return KOPILOT_MASTER_IDENTITY
  },
}
