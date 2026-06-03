// packages/lib/src/agents/set-tool-restrictions.ts

import {
  type Database,
  database as defaultDb,
  schema,
  type ToolRestrictionMap,
} from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { onCacheEvent } from '../cache'
import { BadRequestError, NotFoundError } from '../errors'
import { getRealtimeService, publishAgentUpdated } from '../realtime'

const logger = createScopedLogger('set-tool-restrictions')

export interface SetAgentToolRestrictionsInput {
  organizationId: string
  agentId: string
  /** Full-replace map (`tool registered-name → arg → ArgRestriction`). */
  restrictions: ToolRestrictionMap
}

/**
 * Full-replace write of `Agent.toolRestrictions`. Mirrors the
 * `set_agent_toolsets` semantics — the caller sends the complete map and it
 * overwrites the column wholesale (no merge, no pruning of disabled-tool
 * entries; kept restrictions stay inert per plans/chat/v6 phase-4 lifecycle).
 *
 * Validation is intentionally **warn-not-reject** on drift so phase-5 hidden
 * app fields and tool-schema changes don't hard-fail a save:
 *   - `source: 'var'` — the var id must parse to a known anchor (`visitor` /
 *     `thread`) with a non-empty ref. We do NOT gate on registry membership:
 *     hidden-but-resolvable app fields (e.g. Shopify's `customerId`) are
 *     excluded from the picker registry yet must still bind. A malformed id is
 *     the only hard reject.
 *   - `source: 'constant'` — a `value` must be present (a constant with no
 *     value is a no-op that would silently behave like `model`).
 *   - arg/tool existence against the current schema is the UI's concern (it
 *     only offers current args); stale entries are kept and re-validated on
 *     re-add, never rejected here.
 *
 * Reused by the phase-4 admin mutation and phase-6 builder Kopilot.
 */
export async function setAgentToolRestrictions(
  { organizationId, agentId, restrictions }: SetAgentToolRestrictionsInput,
  db: Database = defaultDb as Database
): Promise<void> {
  validateRestrictions(restrictions)

  const now = new Date()
  const result = await db
    .update(schema.Agent)
    .set({ toolRestrictions: restrictions, updatedAt: now })
    .where(and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)))
    .returning({ id: schema.Agent.id })

  if (result.length === 0) {
    throw new NotFoundError(`Agent not found: ${agentId}`)
  }

  try {
    await onCacheEvent('agent.updated', { orgId: organizationId })
  } catch (err) {
    logger.warn('Failed to invalidate caches after tool-restrictions update', {
      organizationId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  await publishAgentUpdated(getRealtimeService(), organizationId, { agentId })
}

/** Hard-reject only the structurally-broken cases; warn on everything else. */
function validateRestrictions(restrictions: ToolRestrictionMap): void {
  for (const [toolName, perTool] of Object.entries(restrictions)) {
    for (const [arg, r] of Object.entries(perTool)) {
      if (r.source === 'var') {
        if (!r.var || !parsesAsVarId(r.var)) {
          throw new BadRequestError(
            `Invalid var binding for ${toolName}.${arg}: "${r.var ?? ''}" is not a valid var id`
          )
        }
      } else if (r.source === 'constant') {
        if (r.value === undefined) {
          throw new BadRequestError(
            `Constant restriction for ${toolName}.${arg} is missing a value`
          )
        }
      }
    }
  }
}

/**
 * A var id is `<anchor>:<ref>` with `anchor ∈ {visitor, thread}` and a
 * non-empty `ref` (which may itself contain colons, e.g.
 * `visitor:contact:primary_email`). Mirrors `parseVarId` in `var-registry.ts`
 * — kept inline so this server module stays free of the resolver's deps.
 */
function parsesAsVarId(varId: string): boolean {
  const idx = varId.indexOf(':')
  if (idx <= 0 || idx === varId.length - 1) return false
  const anchor = varId.slice(0, idx)
  return anchor === 'visitor' || anchor === 'thread'
}
