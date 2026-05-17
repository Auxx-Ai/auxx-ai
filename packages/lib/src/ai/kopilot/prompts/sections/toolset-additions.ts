// packages/lib/src/ai/kopilot/prompts/sections/toolset-additions.ts

import { ALL_MODES, type PromptSection } from './types'

export const toolsetAdditions: PromptSection = {
  id: 'toolset-additions',
  modes: ALL_MODES,
  stability: 'org',
  render: (ctx) => {
    const body = ctx.toolsetPromptAdditions.trim()
    return body || null
  },
}
