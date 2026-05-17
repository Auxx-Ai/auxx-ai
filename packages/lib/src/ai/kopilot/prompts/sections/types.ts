// packages/lib/src/ai/kopilot/prompts/sections/types.ts

import type { ResolvedAgentConfig } from '../../../../agents'
import type { IntegrationCatalogEntry } from '../../../../cache/integration-catalog'
import type { AgentToolDefinition } from '../../../agent-framework/types'
import type { KopilotDomainState } from '../../types'
import type { CurrentUserInfo, EntityCatalogEntry } from '../shared-types'
import type { TriggerContext } from '../trigger-context'

export type RunMode = 'interactive' | 'autonomous'

export const ALL_MODES: ReadonlySet<RunMode> = new Set(['interactive', 'autonomous'])
export const INTERACTIVE_ONLY: ReadonlySet<RunMode> = new Set(['interactive'])
export const AUTONOMOUS_ONLY: ReadonlySet<RunMode> = new Set(['autonomous'])

/**
 * Stability tier — drives cache-tier grouping in Phase E.
 *
 * - `static` — same across every org and every turn; only changes on deploy.
 * - `org`    — stable until an admin edits entities / connects integrations / edits the agent.
 * - `turn`   — rebuilt on every call; never cached.
 *
 * The registry MUST be ordered such that all `static` sections come before
 * all `org` sections, which come before all `turn` sections. `validateStabilityOrder`
 * enforces this in development.
 */
export type Stability = 'static' | 'org' | 'turn'

/**
 * Read-only inputs each section can use. Built once per turn at the top of
 * `buildKopilotPrompt` and passed verbatim to every section. Pre-computed
 * fields (`toolNames`) avoid recomputing in each section.
 */
export interface PromptCtx {
  readonly runMode: RunMode
  readonly tools: readonly AgentToolDefinition[]
  readonly toolNames: ReadonlySet<string>
  readonly currentUser: CurrentUserInfo | null
  readonly integrations: readonly IntegrationCatalogEntry[]
  readonly entityCatalog: readonly EntityCatalogEntry[]
  readonly domainState: KopilotDomainState
  readonly toolsetPromptAdditions: string
  // Persona inputs (Phase D)
  readonly agentConfig: ResolvedAgentConfig | undefined
  readonly capabilities: readonly string[]
  readonly instructionsReferences?: (id: string) => string
  // Trigger inputs (Phase D)
  readonly triggerContext: TriggerContext | undefined
}

export interface PromptSection {
  /** Stable identifier — used in tests, debug dumps, and ordering operations. */
  readonly id: string
  /** Modes this section may render in. Empty ≡ never (useful for staging). */
  readonly modes: ReadonlySet<RunMode>
  /** Cache stability tier — see `Stability`. */
  readonly stability: Stability
  /**
   * Return a trimmed string, or null/empty to omit at runtime.
   * Contract: NO leading or trailing whitespace. Composer joins with `\n\n`.
   */
  render(ctx: PromptCtx): string | null
}
