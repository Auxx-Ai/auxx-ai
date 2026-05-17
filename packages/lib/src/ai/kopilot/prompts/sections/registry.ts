// packages/lib/src/ai/kopilot/prompts/sections/registry.ts

import { activeRefs } from './active-refs'
import { agentPersona } from './agent-persona'
import { approval } from './approval'
import { blockCatalog } from './block-catalog'
import { callerPreamble } from './caller-preamble'
import { contextSection } from './context'
import { entityCatalog } from './entity-catalog'
import { houseRules } from './house-rules'
import { instructions } from './instructions'
import { integrationCatalog } from './integration-catalog'
import { jobStatement } from './job-statement'
import { masterCapabilities } from './master-capabilities'
import { masterPersona } from './master-persona'
import { membersVsContacts } from './members-vs-contacts'
import { runModeBanner } from './run-mode-banner'
import { toolBlock } from './tool-block'
import { toolsetAdditions } from './toolset-additions'
import { triggerActingAs } from './trigger-acting-as'
import { triggerFired } from './trigger-fired'
import { triggerInstructions } from './trigger-instructions'
import type { PromptSection, Stability } from './types'

/**
 * Ordered list of every section in the full system prompt, grouped by
 * cache-stability tier:
 *
 *   tier 1 (static) — same for every org/turn, only changes on deploy
 *   tier 2 (org)    — stable until admin edits entities/integrations/agent
 *   tier 3 (turn)   — rebuilt every call, never cached
 *
 * `validateStabilityOrder` enforces that the list is sorted static → org →
 * turn so cache breakpoints fall in valid places.
 *
 * To change the prompt:
 * - reorder within a tier: move a line
 * - omit: drop from a section's `modes`
 * - add: create a new sections/<name>.ts and import it here, in tier order
 */
export const SYSTEM_PROMPT_SECTIONS: readonly PromptSection[] = [
  // ─── Tier 1 — static ──────────────────────────────────────────────────
  masterPersona, // identity line only; user-authored renders agentPersona
  jobStatement,
  instructions,
  membersVsContacts,
  blockCatalog,
  approval,
  runModeBanner,
  houseRules, // last in tier 1 — strongest recency vs persona

  // ─── Tier 2 — per-org / per-agent ─────────────────────────────────────
  agentPersona, // user-authored only
  masterCapabilities, // master only
  triggerInstructions,
  triggerActingAs,
  entityCatalog,
  integrationCatalog,
  toolBlock,
  toolsetAdditions,

  // ─── Tier 3 — per-turn ────────────────────────────────────────────────
  triggerFired,
  contextSection,
  activeRefs,
  callerPreamble,
]

const ABOVE_CORE_IDS = new Set([
  'master-persona',
  'agent-persona',
  'master-capabilities',
  'trigger-fired',
  'trigger-acting-as',
  'trigger-instructions',
  'run-mode-banner',
  'house-rules',
])

/**
 * Core-only slice — used by `buildCoreRuntimePrompt` and its existing
 * tests. Tier ordering is preserved (filter does not reorder).
 */
export const CORE_SECTIONS: readonly PromptSection[] = SYSTEM_PROMPT_SECTIONS.filter(
  (s) => !ABOVE_CORE_IDS.has(s.id)
)

const TIER_INDEX: Record<Stability, number> = { static: 0, org: 1, turn: 2 }

/**
 * Assert the registry is ordered static → org → turn. Phase E.2's block
 * grouping depends on this — interleaved tiers would put cache breakpoints
 * in the middle of a tier and silently disable caching.
 */
export function validateStabilityOrder(
  sections: readonly PromptSection[] = SYSTEM_PROMPT_SECTIONS
): void {
  let max = 0
  for (const s of sections) {
    const idx = TIER_INDEX[s.stability]
    if (idx < max) {
      throw new Error(
        `prompt registry out of stability order: "${s.id}" (${s.stability}) follows a higher tier`
      )
    }
    max = idx
  }
}

if (process.env.NODE_ENV !== 'production') {
  validateStabilityOrder()
}
