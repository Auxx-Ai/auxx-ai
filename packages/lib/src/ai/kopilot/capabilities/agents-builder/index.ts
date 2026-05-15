// packages/lib/src/ai/kopilot/capabilities/agents-builder/index.ts

import { getOrgToolsetCatalog } from '../../../../agents/toolset-catalog'
import type { GetToolDeps, PageCapability } from '../types'
import { buildBuilderPersonaPrompt } from './persona-prompt'
import { createCompleteAgentSetupTool } from './tools/complete-agent-setup'
import { createSetAgentPromptTool } from './tools/set-agent-prompt'
import { createSetAgentResourceScopeTool } from './tools/set-agent-resource-scope'
import { createSetAgentToolsetsTool } from './tools/set-agent-toolsets'
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
 * concrete toolsets by slug without needing a separate discovery tool. The
 * caller must pre-fetch the catalog via `getOrgToolsetCatalog` and pass it
 * in — keeps this factory synchronous to match the rest of the registry.
 */
export async function createAgentsBuilderCapabilities(
  getDeps: GetToolDeps,
  organizationId: string
): Promise<PageCapability> {
  const catalog = await getOrgToolsetCatalog(organizationId)
  return {
    page: AGENTS_BUILDER_PAGE,
    tools: [
      createUpdateAgentIdentityTool(getDeps),
      createSetAgentPromptTool(getDeps),
      createSetAgentToolsetsTool(getDeps),
      createSetAgentResourceScopeTool(getDeps),
      createCompleteAgentSetupTool(getDeps),
    ],
    systemPromptAddition: buildBuilderPersonaPrompt({ catalog }),
    capabilities: ['Edit one agent in this workspace — name, prompt, tools, knowledge scope'],
  }
}

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
