// packages/lib/src/ai/kopilot/prompts/sections/entity-catalog.ts

import { ALL_MODES, type PromptSection } from './types'

export const entityCatalog: PromptSection = {
  id: 'entity-catalog',
  modes: ALL_MODES,
  stability: 'org',
  render: (ctx) => {
    if (!ctx.entityCatalog.length) return null
    const lines = ctx.entityCatalog.map((e) => `- **${e.label}** (${e.plural}) — \`${e.apiSlug}\``)
    return `## Available Entity Types\nPass the apiSlug (the value in backticks) as the \`entityDefinitionId\` / \`entity\` parameter in tools. Never invent slugs that aren't in this list.\n${lines.join('\n')}`
  },
}
