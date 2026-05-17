// packages/lib/src/ai/kopilot/prompts/sections/tool-block.ts

import { ALL_MODES, type PromptSection } from './types'

/**
 * Auto-generates per-tool usage guidance from declarative metadata.
 *
 * Each tool that declares `usageNotes` gets a short stanza here. Tools that
 * don't declare any usage notes don't appear at all — keeps the prompt lean.
 */
export const toolBlock: PromptSection = {
  id: 'tool-block',
  modes: ALL_MODES,
  stability: 'org',
  render: (ctx) => {
    const entries = ctx.tools
      .filter((t) => t.usageNotes)
      .map((t) => `### \`${t.name}\`\n${t.usageNotes}`)
    if (!entries.length) return null
    return `## How tools surface results\n\n${entries.join('\n\n')}`
  },
}
