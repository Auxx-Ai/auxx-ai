// packages/lib/src/ai/kopilot/capabilities/mail/index.ts

import type { GetToolDeps, PageCapability } from '../types'
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
    systemPromptAddition:
      "You have access to the user's connected conversation channels (email, SMS, WhatsApp, Facebook DM, Instagram DM). You can search threads, read messages, draft or send replies, start brand-new conversations on integrations that support it, and manage thread status/tags/assignment. Tags are referenced by ID — when the user mentions a tag by name, call `list_tags` first to resolve it before passing IDs to `update_thread` or `find_threads`.",
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
