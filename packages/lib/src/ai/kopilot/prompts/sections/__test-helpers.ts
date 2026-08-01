// packages/lib/src/ai/kopilot/prompts/sections/__test-helpers.ts

import type { PromptCtx, RunMode } from './types'

/**
 * Build a minimal `PromptCtx` for section unit tests. Pass overrides to
 * exercise the fields the section under test cares about.
 */
export function makeCtx(overrides: Partial<PromptCtx> & { runMode: RunMode }): PromptCtx {
  return {
    runMode: overrides.runMode,
    // Defaults reproduce the in-app member path; tests override as needed.
    surface: overrides.surface ?? 'builder',
    audience: overrides.audience ?? 'member',
    tools: overrides.tools ?? [],
    toolNames: overrides.toolNames ?? new Set((overrides.tools ?? []).map((t) => t.name)),
    currentUser: overrides.currentUser ?? null,
    timezone: overrides.timezone,
    integrations: overrides.integrations ?? [],
    entityCatalog: overrides.entityCatalog ?? [],
    domainState: overrides.domainState ?? { context: {} },
    toolsetPromptAdditions: overrides.toolsetPromptAdditions ?? '',
    agentConfig: overrides.agentConfig,
    capabilities: overrides.capabilities ?? [],
    instructionsReferences: overrides.instructionsReferences,
    triggerContext: overrides.triggerContext,
  }
}
