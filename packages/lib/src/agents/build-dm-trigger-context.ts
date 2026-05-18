// packages/lib/src/agents/build-dm-trigger-context.ts

import type { CachedAgent } from '../cache/org-cache-keys'
import { ForbiddenError } from '../errors'

export interface DmTriggerContext {
  kind: 'dm'
  triggerId: string
  firedAt: string
}

export interface BuildDmTriggerContextResult {
  triggerContext: DmTriggerContext
  triggerInstructions: Record<string, unknown> | null
}

/**
 * Resolves DM trigger gating from a cached agent. Throws `ForbiddenError`
 * if DMs are disabled or the `dm` AgentTrigger row is missing.
 *
 * Pure — no DB I/O. The cached agent carries `dmEnabled` / `dmInstructions`
 * / `dmTriggerId` from the `agents` cache provider's left-join on
 * `AgentTrigger` where `kind = 'dm'`.
 */
export function buildDmTriggerContext(args: { agent: CachedAgent }): BuildDmTriggerContextResult {
  if (!args.agent.dmEnabled || !args.agent.dmTriggerId) {
    throw new ForbiddenError('Direct messages are disabled for this agent')
  }
  return {
    triggerContext: {
      kind: 'dm',
      triggerId: args.agent.dmTriggerId,
      firedAt: new Date().toISOString(),
    },
    triggerInstructions: args.agent.dmInstructions,
  }
}
