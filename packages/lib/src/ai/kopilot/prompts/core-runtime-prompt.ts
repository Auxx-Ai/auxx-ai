// packages/lib/src/ai/kopilot/prompts/core-runtime-prompt.ts

import type { AgentSurface } from '../../../agents/client'
import type { IntegrationCatalogEntry } from '../../../cache/integration-catalog'
import type { AgentToolDefinition } from '../../agent-framework/types'
import type { KopilotDomainState } from '../types'
import { CORE_SECTIONS } from './sections/registry'
import { renderSections } from './sections/render'
import type { Audience, PromptCtx, RunMode } from './sections/types'
import type { CurrentUserInfo, EntityCatalogEntry } from './shared-types'

export type { RunMode } from './sections/types'

/**
 * Invariant runtime prompt — the 13 core sections (job statement, context,
 * catalogs, tool/block grammar, instructions, toolset additions).
 *
 * Persona and trigger-context live above this in the unified registry used
 * by `buildKopilotPrompt`. This entry stays for tests and any direct
 * callers that need just the core slice.
 */
export function buildCoreRuntimePrompt(args: {
  domainState: KopilotDomainState
  entityCatalog: EntityCatalogEntry[]
  tools: AgentToolDefinition[]
  currentUser: CurrentUserInfo | null
  integrations: IntegrationCatalogEntry[]
  toolsetPromptAdditions: string
  runMode: RunMode
  /** Rendering medium → formatting. Defaults to the in-app `'builder'` surface. */
  surface?: AgentSurface
  /** Who reads the output → semantics. Defaults to `'member'`. */
  audience?: Audience
}): string {
  const ctx: PromptCtx = {
    runMode: args.runMode,
    surface: args.surface ?? 'builder',
    audience: args.audience ?? 'member',
    tools: args.tools,
    toolNames: new Set(args.tools.map((t) => t.name)),
    currentUser: args.currentUser,
    integrations: args.integrations,
    entityCatalog: args.entityCatalog,
    domainState: args.domainState,
    toolsetPromptAdditions: args.toolsetPromptAdditions,
    agentConfig: undefined,
    capabilities: [],
    instructionsReferences: undefined,
    triggerContext: undefined,
  }
  return renderSections(CORE_SECTIONS, ctx)
}
