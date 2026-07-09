// packages/lib/src/ai/kopilot/prompts/sections/types.ts

import type { ResolvedAgentConfig } from '../../../../agents'
import type { AgentSurface } from '../../../../agents/client'
import type { IntegrationCatalogEntry } from '../../../../cache/integration-catalog'
import type { KbCatalogEntry } from '../../../../kb/catalog/kb-catalog'
import type { AgentToolDefinition } from '../../../agent-framework/types'
import type { KopilotDomainState } from '../../types'
import type { CurrentUserInfo, EntityCatalogEntry } from '../shared-types'
import type { TriggerContext } from '../trigger-context'

export type RunMode = 'interactive' | 'autonomous'

export const ALL_MODES: ReadonlySet<RunMode> = new Set(['interactive', 'autonomous'])
export const INTERACTIVE_ONLY: ReadonlySet<RunMode> = new Set(['interactive'])
export const AUTONOMOUS_ONLY: ReadonlySet<RunMode> = new Set(['autonomous'])

/**
 * Who reads this turn's output. Orthogonal to {@link RunMode} (human-in-loop vs
 * not) and to {@link AgentSurface} (the rendering medium):
 *
 * - `member`   — a workspace member (in-app Kopilot, background-trigger audit
 *   trail). Real ids / tool names / error codes are surfaced — they're debugging.
 * - `customer` — an external person on the other end of a conversation (live
 *   chat, customer email). Drives plain-language semantics: no internal ids,
 *   tool names, link syntax, and tool-failure opacity (never name the failing
 *   integration or quote an error code; ask or hand off).
 *
 * Computed per-run at the entry point — NOT a stored column and NOT
 * `agent.kind === 'chat'` (they coincide today but diverge the moment an
 * `internal`/`email` agent serves a customer).
 */
export type Audience = 'member' | 'customer'

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
 * The top frame's active procedure step for the `agentProcedureStep` section (v9
 * procedures, Phase 3). Phase 4 populates this from `prepareTurn`'s result while a
 * frame is active; it is left unset on free-form / persona-only turns so the section
 * drops out (PROCEDURE-STACK #9).
 */
export interface ProcedureStepInput {
  /** The active `instruction` step to inject — its TipTap `doc` is rendered via `docToText`. */
  readonly activeStep: { readonly doc: unknown }
  /** The pinned version's doc-level maps so inline `subprocedure:`/`code:` badges render names. */
  readonly procedureMaps?: {
    subProcedures?: { id: string; name: string }[]
    codeBlocks?: { id: string; name: string }[]
  }
  /** Stack depth — `> 1` renders the thin "side request" breadcrumb. */
  readonly depth: number
  /** Depth > 1: a short label for the side request being handled. */
  readonly topicLabel?: string
  /** Depth > 1: a short label for what the agent returns to. */
  readonly returnToLabel?: string
  /** Re-anchor line on a pop-resume turn (PROCEDURE-STACK §5). */
  readonly breadcrumb?: string
  /** `surfaceToModel` outputs computed by `code` steps walked this turn (v9 Phase 5, D4). */
  readonly codeOutputs?: { name: string; value: unknown }[]
  /** Failure notes from `code` steps that threw/timed out this turn (v9 Phase 5, D5). */
  readonly codeErrors?: { codeBlockId: string; error: string }[]
}

/**
 * Read-only inputs each section can use. Built once per turn at the top of
 * `buildKopilotPrompt` and passed verbatim to every section. Pre-computed
 * fields (`toolNames`) avoid recomputing in each section.
 */
export interface PromptCtx {
  readonly runMode: RunMode
  /** The rendering medium this turn outputs to → drives formatting. */
  readonly surface: AgentSurface
  /** Who reads this turn's output → drives semantics (see {@link Audience}). */
  readonly audience: Audience
  readonly tools: readonly AgentToolDefinition[]
  readonly toolNames: ReadonlySet<string>
  readonly currentUser: CurrentUserInfo | null
  readonly integrations: readonly IntegrationCatalogEntry[]
  readonly entityCatalog: readonly EntityCatalogEntry[]
  /** Published KB articles ToC — browse-first knowledge retrieval. */
  readonly kbCatalog?: readonly KbCatalogEntry[]
  readonly domainState: KopilotDomainState
  readonly toolsetPromptAdditions: string
  // Persona inputs (Phase D)
  readonly agentConfig: ResolvedAgentConfig | undefined
  readonly capabilities: readonly string[]
  readonly instructionsReferences?: (id: string) => string
  // Trigger inputs (Phase D)
  readonly triggerContext: TriggerContext | undefined
  // Procedure stepper (Phase 3) — set by Phase 4 only while a frame is active.
  readonly procedureStep?: ProcedureStepInput
}

export interface PromptSection {
  /** Stable identifier — used in tests, debug dumps, and ordering operations. */
  readonly id: string
  /** Modes this section may render in. Empty ≡ never (useful for staging). */
  readonly modes: ReadonlySet<RunMode>
  /**
   * Surfaces this section may render on. `undefined` ⇒ all surfaces
   * (back-compat default). Mirrors `modes` — the renderer skips a section
   * whose set doesn't include `ctx.surface`.
   */
  readonly surfaces?: ReadonlySet<AgentSurface>
  /** Audiences this section may render for. `undefined` ⇒ all audiences. */
  readonly audiences?: ReadonlySet<Audience>
  /** Cache stability tier — see `Stability`. */
  readonly stability: Stability
  /**
   * Return a trimmed string, or null/empty to omit at runtime.
   * Contract: NO leading or trailing whitespace. Composer joins with `\n\n`.
   */
  render(ctx: PromptCtx): string | null
}
