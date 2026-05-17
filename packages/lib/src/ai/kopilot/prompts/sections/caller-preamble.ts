// packages/lib/src/ai/kopilot/prompts/sections/caller-preamble.ts

import { INTERACTIVE_ONLY, type PromptSection } from './types'

export const callerPreamble: PromptSection = {
  id: 'caller-preamble',
  modes: INTERACTIVE_ONLY,
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
