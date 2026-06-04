// packages/lib/src/agents/set-tool-restrictions.ts

import {
  type AgentToolBindings,
  type Database,
  database as defaultDb,
  schema,
} from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { onCacheEvent } from '../cache'
import { BadRequestError, NotFoundError } from '../errors'
import { getRealtimeService, publishAgentUpdated } from '../realtime'

const logger = createScopedLogger('set-tool-bindings')

export interface SetAgentToolBindingsInput {
  organizationId: string
  agentId: string
  /**
   * Full-replace OVERRIDE map (`tool registered-name → input → VarSource`),
   * in the persisted structural shape (`ref` as `string | string[]`).
   */
  bindings: AgentToolBindings
}

/**
 * Full-replace write of `Agent.toolRestrictions` (the v8 per-agent **override**
 * map). The caller sends the complete override map and it overwrites the column
 * wholesale — no merge. An entry exists only when an admin deliberately changed
 * an input away from its author default; an empty map means "everything runs on
 * author defaults".
 *
 * Validation hard-rejects only the structurally-broken cases:
 *   - `var` — must carry a non-empty `ref` (a `ResourceFieldId` string or a
 *     `FieldPath` array of length ≥ 1).
 *   - `const` — must carry a `value` (a const with no value is a no-op that
 *     would silently behave like `model`).
 *   - `model` — always valid (un-binds the author default).
 *
 * Input/tool existence against the current schema is the UI's concern (it only
 * offers current inputs); stale entries are kept and re-validated on re-add.
 *
 * See plans/chat/v8 phase-5.
 */
export async function setAgentToolBindings(
  { organizationId, agentId, bindings }: SetAgentToolBindingsInput,
  db: Database = defaultDb as Database
): Promise<void> {
  validateBindings(bindings)

  const now = new Date()
  const result = await db
    .update(schema.Agent)
    .set({ toolRestrictions: bindings, updatedAt: now })
    .where(and(eq(schema.Agent.id, agentId), eq(schema.Agent.organizationId, organizationId)))
    .returning({ id: schema.Agent.id })

  if (result.length === 0) {
    throw new NotFoundError(`Agent not found: ${agentId}`)
  }

  try {
    await onCacheEvent('agent.updated', { orgId: organizationId })
  } catch (err) {
    logger.warn('Failed to invalidate caches after tool-bindings update', {
      organizationId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  await publishAgentUpdated(getRealtimeService(), organizationId, { agentId })
}

/** Hard-reject only the structurally-broken bindings; everything else is valid. */
function validateBindings(bindings: AgentToolBindings): void {
  for (const [toolName, perTool] of Object.entries(bindings)) {
    for (const [input, source] of Object.entries(perTool)) {
      if (source.kind === 'var') {
        const ref = source.ref
        const ok = Array.isArray(ref) ? ref.length > 0 : typeof ref === 'string' && ref.length > 0
        if (!ok) {
          throw new BadRequestError(`Var binding for ${toolName}.${input} is missing a ref`)
        }
      } else if (source.kind === 'const') {
        if (source.value === undefined) {
          throw new BadRequestError(`Constant binding for ${toolName}.${input} is missing a value`)
        }
      }
    }
  }
}
