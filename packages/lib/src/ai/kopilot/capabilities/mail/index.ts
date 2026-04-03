// packages/lib/src/ai/kopilot/capabilities/mail/index.ts

import type { GetToolDeps, PageCapability } from '../types'
import { createDraftReplyTool } from './tools/draft-reply'
import { createFindThreadsTool } from './tools/find-threads'
import { createGetThreadDetailTool } from './tools/get-thread-detail'
import { createSearchKBTool } from './tools/search-kb'
import { createSendReplyTool } from './tools/send-reply'
import { createUpdateThreadTool } from './tools/update-thread'

/**
 * Create the mail page capability set.
 * Provides 6 tools for thread search, reading, drafting, sending, updating, and KB search.
 */
export function createMailCapabilities(getDeps: GetToolDeps): PageCapability {
  return {
    page: 'mail',
    tools: [
      createFindThreadsTool(getDeps),
      createGetThreadDetailTool(getDeps),
      createDraftReplyTool(getDeps),
      createSendReplyTool(getDeps),
      createUpdateThreadTool(getDeps),
      createSearchKBTool(getDeps),
    ],
    systemPromptAddition:
      "You have access to the user's email inbox. You can search threads, read messages, draft and send replies, manage thread status/tags/assignment, and search the knowledge base.",
  }
}
