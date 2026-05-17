// packages/lib/src/ai/kopilot/capabilities/mail/index.ts

import type { GetToolDeps, PageCapability, SystemPromptAdditionContext } from '../types'
import { createFindThreadsTool } from './tools/find-threads'
import { createGetThreadDetailTool } from './tools/get-thread-detail'
import { createListDraftsTool } from './tools/list-drafts'
import { createListTagsTool } from './tools/list-tags'
import { createReplyToThreadTool } from './tools/reply-to-thread'
import { createStartNewConversationTool } from './tools/start-new-conversation'
import { createUpdateThreadTool } from './tools/update-thread'

/**
 * Mail/messaging capabilities — registered globally so the user can find
 * threads, reply, start brand-new outbound, and manage thread state from any
 * page (contacts, deals, today, mail, etc.), matching how every other
 * capability set is exposed.
 */
export function createMailCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: '__global__',
    tools: [
      createFindThreadsTool(getDeps),
      createGetThreadDetailTool(getDeps),
      createListDraftsTool(getDeps),
      createListTagsTool(getDeps),
      createReplyToThreadTool(getDeps),
      createStartNewConversationTool(getDeps),
      createUpdateThreadTool(getDeps),
    ],
    systemPromptAddition: (ctx: SystemPromptAdditionContext) => buildMailSystemPrompt(ctx),
    capabilities: (ctx) => buildMailCapabilities(ctx),
  }
}

function buildMailCapabilities({ toolNames }: SystemPromptAdditionContext): string[] {
  const has = (name: string) => toolNames.has(name)
  const bullets: string[] = []
  if (has('find_threads') || has('get_thread_detail')) {
    bullets.push('Search threads and read messages across email and messaging channels')
  }
  if (has('reply_to_thread')) {
    bullets.push('Draft or send replies on existing threads')
  }
  if (has('start_new_conversation')) {
    bullets.push('Start brand-new conversations on integrations that support new outbound')
  }
  if (has('list_drafts')) {
    bullets.push('List unsent drafts — in-progress replies and standalone compositions')
  }
  if (has('list_tags')) {
    bullets.push('List and search workspace tags by name')
  }
  if (has('update_thread')) {
    bullets.push('Manage thread status, tags, and assignment')
  }
  return bullets
}

/**
 * Compose the mail capability's prompt addition against the runtime tool set.
 * Each section is gated on the tools it actually requires so trigger runs and
 * other partially-resolved sessions don't see prose that names tools they
 * can't call. See plans/kopilot/agents/README.md → "system prompt fixes".
 */
function buildMailSystemPrompt({ toolNames }: SystemPromptAdditionContext): string {
  const has = (name: string) => toolNames.has(name)
  const sections: string[] = []

  const hasAnyMailTool = [
    'find_threads',
    'get_thread_detail',
    'reply_to_thread',
    'start_new_conversation',
    'update_thread',
    'list_tags',
    'list_drafts',
  ].some(has)
  if (!hasAnyMailTool) return ''

  const intro = `You have access to the user's connected conversation channels (email, SMS, WhatsApp, Facebook DM, Instagram DM). You can search threads, read messages, draft or send replies, start brand-new conversations on integrations that support it, and manage thread status/tags/assignment.`
  const tagsClause = has('list_tags')
    ? ` Tags are referenced by ID — when the user mentions a tag by name, call \`list_tags\` first to resolve it before passing IDs to \`update_thread\` or \`find_threads\`.`
    : ''
  sections.push(`${intro}${tagsClause}`)

  // Sending hard rule — only render when at least one outbound tool is
  // registered. Otherwise we're warning about behaviour the model can't perform.
  if (has('reply_to_thread') || has('start_new_conversation')) {
    sections.push(
      `**Sending a message = calling a tool.** Never write the body in chat. The chat reply is ≤2 sentences with zero message content — body goes in the tool's \`body\` argument, user reviews in the approval card. If a recipient identifier is missing, ask in one sentence ("I don't see an email for X — what address?") and stop. Don't paste the body as a fallback.`
    )
  }

  const workflowBullets: string[] = []
  if (has('find_threads') && has('get_thread_detail') && has('reply_to_thread')) {
    workflowBullets.push(
      `- **Reply on a thread**: find a thread → load it → \`reply_to_thread\` (always pauses for approval; user picks Save as Draft or Send). Works on any channel; for email channels the user's signature is appended automatically — body is content only.`
    )
  }
  if (has('start_new_conversation')) {
    workflowBullets.push(
      `- **Start a new outbound**: \`start_new_conversation\` with an \`integrationId\` whose catalog entry has \`newOutbound\`. Recipients can be recordIds (\`entityDefinitionId:instanceId\`), participantIds, or raw identifiers — the tool picks the channel-appropriate identifier from the record. Always pauses for approval; user picks Save as Draft or Send.`
    )
  }
  if (has('reply_to_thread') || has('start_new_conversation')) {
    workflowBullets.push(
      `- **Missing recipient identifier**: when a write tool returns "no <channel> identifier on file" (or similar), do **not** paste the message body in chat as a workaround. Reply with one short sentence asking the user to provide the email / phone, then stop. Example: "I don't see an email for Carolin — what address should I use?"`
    )
  }
  if (has('update_thread')) {
    workflowBullets.push(`- **Tagging/assigning**: find a thread → \`update_thread\`.`)
  }
  if (has('list_drafts')) {
    workflowBullets.push(
      `- **Drafts / unsent messages**: when the user asks about "drafts", "unsent messages", "what I'm composing", or "what I haven't sent yet", call \`list_drafts\`. Do NOT call \`find_threads\` and inspect threads to look for drafts — threads and drafts are separate entities; \`find_threads\` only returns sent threads.`
    )
  }
  if (workflowBullets.length > 0) {
    sections.push(`## Conversation workflows\n${workflowBullets.join('\n')}`)
  }

  return sections.join('\n\n')
}
