// packages/lib/src/ai/kopilot/prompts/sections/master-capabilities.ts

import { ALL_MODES, type PromptSection } from './types'

/**
 * Per-org capabilities list for the master Kopilot persona. Lives in tier 2
 * because the underlying capability set is derived from the org's enabled
 * page capabilities — stable until an admin toggles one.
 *
 * Only renders for the master persona (user-authored agents declare their
 * own scope in their persona body).
 */
export const masterCapabilities: PromptSection = {
  id: 'master-capabilities',
  modes: ALL_MODES,
  stability: 'org',
  render: (ctx) => {
    if (ctx.agentConfig && ctx.agentConfig.agentId !== null) return null
    if (ctx.capabilities.length === 0) return null
    return `## What you can help with\nDraw from this list when the user asks what you can do; mention only what's relevant to their request:\n${ctx.capabilities.map((c) => `- ${c}`).join('\n')}`
  },
}
