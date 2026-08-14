// packages/lib/src/ai/kopilot/capabilities/workflow-builder/tools/write-tool-helpers.ts

import type { GraphMutationScope } from '../../../../../workflows/graph-edit'
import type { AgentDeps } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { resolveWorkflowAuthoring } from './workflow-authoring-guard'

/** What a write tool needs to call a graph-edit mutation. */
export type WriteResolution = { ok: true; scope: GraphMutationScope } | { ok: false; error: string }

/**
 * Shared preamble of every graph mutation tool: the edit-tier guard (incl. the
 * dirty gate) plus the turn id the snapshot lifecycle keys on. A write without
 * a `turnId` would take no pre-turn snapshot — no revert-on-failure, so a
 * half-applied turn couldn't be rolled back — so it is refused outright (KB
 * `runBlockCrudOp` parity).
 */
export async function resolveWorkflowWrite(
  getDeps: GetToolDeps,
  agentDeps: AgentDeps
): Promise<WriteResolution> {
  const auth = await resolveWorkflowAuthoring(getDeps, agentDeps, 'edit', { mutation: true })
  if (!auth.ok) return auth
  const turnId = agentDeps.turnId
  if (!turnId) {
    return {
      ok: false,
      error: 'No turnId on agent deps — cannot scope kopilot workflow writes.',
    }
  }
  return {
    ok: true,
    scope: {
      workflowAppId: auth.workflowAppId,
      organizationId: agentDeps.organizationId,
      turnId,
    },
  }
}

/** Optional-string arg helper — trims, empty → undefined. */
export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Optional plain-object arg helper. */
export function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
