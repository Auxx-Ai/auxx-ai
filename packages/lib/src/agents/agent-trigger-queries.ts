// packages/lib/src/agents/agent-trigger-queries.ts

import { type AgentTriggerEntity, database as defaultDb, schema } from '@auxx/database'
import { and, eq, isNull, or } from 'drizzle-orm'

/**
 * Lookup helpers for the agent-trigger dispatchers. These are direct DB
 * queries today — they hit the dedicated indexes on `AgentTrigger`. A
 * future PR may layer in caching mirroring the workflow-app cache.
 */

/** CRUD-mode event lookup. Hits `AgentTrigger_orgId_event_crud_idx`. */
export async function getAgentTriggersByCrudEvent(params: {
  organizationId: string
  triggerType: 'created' | 'updated' | 'deleted'
  entityDefinitionId: string
  db?: typeof defaultDb
}): Promise<AgentTriggerEntity[]> {
  const db = params.db ?? defaultDb
  return db
    .select()
    .from(schema.AgentTrigger)
    .where(
      and(
        eq(schema.AgentTrigger.organizationId, params.organizationId),
        eq(schema.AgentTrigger.kind, 'event'),
        eq(schema.AgentTrigger.enabled, true),
        eq(schema.AgentTrigger.triggerType, params.triggerType),
        eq(schema.AgentTrigger.entityDefinitionId, params.entityDefinitionId)
      )
    )
}

/** Direct-match event lookup. Hits `AgentTrigger_orgId_event_direct_idx`. */
export async function getAgentTriggersByDirectEvent(params: {
  organizationId: string
  eventType: string
  db?: typeof defaultDb
}): Promise<AgentTriggerEntity[]> {
  const db = params.db ?? defaultDb
  return db
    .select()
    .from(schema.AgentTrigger)
    .where(
      and(
        eq(schema.AgentTrigger.organizationId, params.organizationId),
        eq(schema.AgentTrigger.kind, 'event'),
        eq(schema.AgentTrigger.enabled, true),
        eq(schema.AgentTrigger.eventType, params.eventType)
      )
    )
}

/**
 * App dispatcher lookup. Hits `AgentTrigger_orgId_app_idx`. `connectionId`
 * is loose: a trigger row with NULL matches any incoming connectionId; a
 * row with a value must equal.
 */
export async function getAgentTriggersByApp(params: {
  organizationId: string
  appId: string
  triggerId: string
  installationId: string
  connectionId?: string | null
  db?: typeof defaultDb
}): Promise<AgentTriggerEntity[]> {
  const db = params.db ?? defaultDb
  const connFilter = params.connectionId
    ? or(
        isNull(schema.AgentTrigger.triggerConnectionId),
        eq(schema.AgentTrigger.triggerConnectionId, params.connectionId)
      )
    : isNull(schema.AgentTrigger.triggerConnectionId)

  return db
    .select()
    .from(schema.AgentTrigger)
    .where(
      and(
        eq(schema.AgentTrigger.organizationId, params.organizationId),
        eq(schema.AgentTrigger.kind, 'app'),
        eq(schema.AgentTrigger.enabled, true),
        eq(schema.AgentTrigger.triggerAppId, params.appId),
        eq(schema.AgentTrigger.triggerAppTriggerId, params.triggerId),
        eq(schema.AgentTrigger.triggerInstallationId, params.installationId),
        connFilter
      )
    )
}

/**
 * Flat key/value `filter` evaluator. The Phase 2 spec keeps filters
 * primitive — exact-match on top-level keys of the resource payload.
 * Returns true when the filter is empty or every key matches.
 */
export function matchesFilter(
  filter: Record<string, unknown> | undefined | null,
  payload: Record<string, unknown> | undefined | null
): boolean {
  if (!filter || Object.keys(filter).length === 0) return true
  if (!payload) return false
  for (const [key, expected] of Object.entries(filter)) {
    if (payload[key] !== expected) return false
  }
  return true
}
