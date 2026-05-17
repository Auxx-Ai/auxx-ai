// packages/lib/src/ai/kopilot/prompts/sections/context.ts

import { ALL_MODES, type PromptSection } from './types'

export const contextSection: PromptSection = {
  id: 'context',
  modes: ALL_MODES,
  stability: 'turn',
  render: (ctx) => {
    const page = ctx.domainState.context.page
    return page ? `## Context\nCurrent page: ${page}` : '## Context'
  },
}
