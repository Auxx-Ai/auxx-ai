// packages/lib/src/ai/kopilot/prompts/sections/integration-catalog.ts

import { ALL_MODES, type PromptSection } from './types'

export const integrationCatalog: PromptSection = {
  id: 'integration-catalog',
  modes: ALL_MODES,
  stability: 'org',
  render: (ctx) => {
    if (!ctx.integrations.length) {
      const fallback =
        ctx.runMode === 'autonomous'
          ? 'No integrations connected. If the trigger instructions require composing or sending, stop and note the missing integration in your summary.'
          : 'No integrations connected. Tell the user to connect one before composing or sending.'
      return `## Available Integrations\n${fallback}`
    }
    const lines = ctx.integrations.map((i) => {
      const caps: string[] = []
      if (i.newOutbound) caps.push('newOutbound')
      if (i.threadReply) caps.push('threadReply')
      if (i.subject) caps.push('subject')
      if (i.ccBcc) caps.push('cc/bcc')
      if (i.drafts) caps.push('drafts')
      if (i.attachments) caps.push('attachments')
      const notes = i.notes ? ` _(${i.notes})_` : ''
      return `- **${i.displayName}** (${i.channel}) — \`${i.integrationId}\` — recipientModel: ${i.recipientModel} — ${caps.join(', ')}${notes}`
    })
    return `## Available Integrations
Use these for \`reply_to_thread\` and \`start_new_conversation\`. Pass the integrationId (in backticks) when starting a new conversation.

Recipients are recordIds / participantIds / raw identifiers — the tool picks the channel-appropriate identifier from the record. Don't fetch a contact's email or phone manually before composing.

${lines.join('\n')}`
  },
}
