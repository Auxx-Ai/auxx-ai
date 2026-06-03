// packages/lib/src/ai/kopilot/capabilities/agents-builder/index.ts

import {
  getOrgChatSafeToolsetCatalog,
  getOrgToolsetCatalog,
} from '../../../../agents/toolset-catalog'
import { getCachedAgentById } from '../../../../cache'
import { findRef } from '../../context-refs'
import type { GetToolDeps, PageCapability } from '../types'
import { buildBuilderPersonaPrompt, buildChatBuilderPersonaPrompt } from './persona-prompt'
import { createCompleteAgentSetupTool } from './tools/complete-agent-setup'
import { createSetAgentPromptTool } from './tools/set-agent-prompt'
import { createSetAgentResourceScopeTool } from './tools/set-agent-resource-scope'
import { createSetAgentRestrictionsTool } from './tools/set-agent-restrictions'
import { createSetAgentToolsetsTool } from './tools/set-agent-toolsets'
import { createSetAgentTriggersTool } from './tools/set-agent-triggers'
import { createSuggestRepliesTool } from './tools/suggest-replies'
import { createUpdateAgentIdentityTool } from './tools/update-agent-identity'

export const AGENTS_BUILDER_PAGE = 'agents.builder'

/**
 * Page capability for the agent builder. Mounts on the `/app/agents/[slug]`
 * detail page; the docked chat there passes `page='agents.builder'` and the
 * `agent` session ref so every tool resolves the right agent from
 * `findRef(ctx, 'agent')` without taking an agentId argument.
 *
 * Persona prompt inlines the org's toolset catalog so the LLM can recommend
 * concrete toolsets by slug without needing a separate discovery tool.
 *
 * Branches on the session agent's `kind` (resolved from the `agent` session
 * ref): a `chat`-kind agent gets the chat-safe toolset catalog, a chat-shaped
 * persona prompt, and a reduced tool set (no triggers / resource-scope);
 * `internal` agents keep the full triage builder. See plans/chat/v5 phase-2b.
 */
export async function createAgentsBuilderCapabilities(
  getDeps: GetToolDeps,
  organizationId: string
): Promise<PageCapability> {
  // Resolve the agent being built so the builder branches on `kind`. The agent
  // is in the session refs (the same ref every setter tool resolves via
  // `findRef`). `kind` is immutable, so resolving once per session build is
  // safe. A chat-kind agent is visitor-facing: chat-safe toolsets only, a
  // chat-shaped persona, and no triggers / resource-scope. See plans/chat/v5
  // phase-2b.
  const agentRef = findRef(getDeps().sessionContext, 'agent')
  const agent = agentRef?.id ? await getCachedAgentById(organizationId, agentRef.id) : null
  const isChat = agent?.kind === 'chat'

  const catalog = isChat
    ? await getOrgChatSafeToolsetCatalog(organizationId)
    : await getOrgToolsetCatalog(organizationId)

  // Chat agents run on the inbound-message gate, never autonomously, and don't
  // read records — drop `set_agent_triggers` + `set_agent_resource_scope`.
  const tools = [
    createUpdateAgentIdentityTool(getDeps),
    createSetAgentPromptTool(getDeps),
    createSetAgentToolsetsTool(getDeps),
    // Bespoke arg-locking, available to both kinds. Most identity scoping is
    // auto-created on tool enablement (phase-6 §1); this covers explicit asks.
    createSetAgentRestrictionsTool(getDeps),
    ...(isChat
      ? []
      : [createSetAgentResourceScopeTool(getDeps), createSetAgentTriggersTool(getDeps)]),
    createCompleteAgentSetupTool(getDeps),
  ]

  return {
    page: AGENTS_BUILDER_PAGE,
    tools,
    excludeGlobalTools: BUILDER_GLOBAL_TOOL_EXCLUDES,
    systemPromptAddition: isChat
      ? buildChatBuilderPersonaPrompt({ catalog })
      : buildBuilderPersonaPrompt({ catalog }),
    capabilities: isChat
      ? ['Configure this visitor chat agent — name, persona, knowledge, escalation']
      : ['Edit one agent in this workspace — name, prompt, tools, knowledge scope'],
  }
}

/**
 * Global tools the builder doesn't need. Keeps the page focused on authoring
 * the agent in session refs — read-only lookups (`search_entities`,
 * `query_records`, `search_knowledge`, `list_members`, etc.) are intentionally
 * NOT excluded so the persona can inline real names in clarifying questions.
 */
const BUILDER_GLOBAL_TOOL_EXCLUDES: string[] = [
  // Inbox / messaging
  'find_threads',
  'get_thread_detail',
  'list_drafts',
  'list_tags',
  'reply_to_thread',
  'start_new_conversation',
  'update_thread',
  // Tasks
  'create_task',
  'list_tasks',
  // Entity writes + history
  'create_entity',
  'update_entity',
  'bulk_update_entity',
  'create_note',
  'list_notes',
  'list_field_changes',
  'get_entity_history',
  'list_transcripts_for_entity',
  'get_transcript',
  // KB authoring / reads (builder authors prompts, not KB articles)
  'get_article',
  'list_articles',
]

/**
 * Global capability for `suggest_replies`. Registered separately so master
 * Kopilot picks it up too — chip rendering is reusable.
 */
export function createSuggestRepliesGlobalCapability(getDeps: GetToolDeps): PageCapability {
  return {
    page: '__global__',
    tools: [createSuggestRepliesTool(getDeps)],
    systemPromptAddition: `When asking the admin a clarifying question with 2–4 obvious answers, call \`suggest_replies\` alongside your natural-language question so chips render above the composer.`,
    capabilities: undefined,
  }
}

export { buildBuilderPersonaPrompt }
