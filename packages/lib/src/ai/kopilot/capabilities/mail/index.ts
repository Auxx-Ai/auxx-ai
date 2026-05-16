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
    capabilities: [
      'Search threads and read messages across email and messaging channels',
      'Draft or send replies on existing threads',
      'Start brand-new conversations on integrations that support new outbound',
      'List unsent drafts — in-progress replies and standalone compositions',
      'List and search workspace tags by name',
      'Manage thread status, tags, and assignment',
    ],
  }
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

  // Hard rules are about *sending* — only render when at least one outbound
  // tool is registered. Otherwise the model is being warned about behaviour
  // it can't perform.
  if (has('reply_to_thread') || has('start_new_conversation')) {
    sections.push(`## Hard rules — read these first

1. **Sending a message means CALLING a tool, not writing prose.** When the user asks you to email/message/text/SMS/DM/contact a person, your job is to call \`start_new_conversation\` (or \`reply_to_thread\` if there's an existing thread) — NEVER write the message body in chat. The chat reply must be ≤2 sentences and contain ZERO message content. The body lives inside the tool call's \`body\` argument; the user reviews it in the approval card, not in chat.
2. **Do NOT pass a \`mode\` argument and do NOT ask "save or send?" in prose.** The approval card always shows "Save as Draft" and "Send" — the user picks. Just call the tool.
3. **Do NOT paste the would-be message body as a fallback when something's missing.** If a recipient identifier is missing, reply with one short sentence asking for it ("I don't see an email for Carolin — what address should I use?") and stop. No body, no subject, no greeting.
4. The chat reply for a send/draft action is one short sentence ("Drafted a reply." / "Composed a message to Carolin.") — the approval card carries the actual content and outcome.`)
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
