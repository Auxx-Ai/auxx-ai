// packages/lib/src/ai/kopilot/prompts/sections/caller-preamble.ts

import type { AgentSurface } from '../../../../agents/client'
import { INTERACTIVE_ONLY, type PromptSection } from './types'

const BUILDER_SURFACE: ReadonlySet<AgentSurface> = new Set(['builder'])

// The caller preamble mentions the workspace member as
// `[name](auxx://actor/<id>)` — in-app link syntax for a member-driven turn.
// Gated to the `builder` surface so it never reaches a chat/email turn (where
// the link syntax would render literally and there's no "caller" to mention).
export const callerPreamble: PromptSection = {
  id: 'caller-preamble',
  modes: INTERACTIVE_ONLY,
  surfaces: BUILDER_SURFACE,
  stability: 'turn',
  render: (ctx) => {
    const user = ctx.currentUser
    if (!user) return null

    const displayName = user.name ?? user.email ?? user.userId
    const emailSuffix = user.name && user.email ? ` <${user.email}>` : ''

    return `## Who you're helping

The **caller**: ${displayName}${emailSuffix} — actorId \`${user.actorId}\`, role ${user.role}. Mention them in prose as \`[${displayName}](auxx://actor/${user.actorId})\`.`
  },
}
