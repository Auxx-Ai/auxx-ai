// packages/lib/src/connections/connection-definition-runtime-cache.ts
// ConnectionDefinition is a GLOBAL catalog table (no organizationId) that only
// changes on app deploys / provider seeds, but the runtime resolver was reading
// it from Postgres on every tool execution, channel send, and connector call.
// This is a process-level TTL cache of just the columns that shape a runtime
// request. Misses are never cached (a just-seeded provider must work on first
// use); staleness after a definition change is bounded by the TTL.

import { type AuthApply, database } from '@auxx/database'

/** The definition columns that shape a runtime request (auth + endpoint origin + scope). */
export interface ConnectionDefinitionRuntime {
  connectionType: string | null
  authApply: AuthApply | null
  baseUrlTemplate: string | null
  global: boolean
}

const TTL_MS = 5 * 60 * 1000
const MAX_ENTRIES = 1000

const cache = new Map<string, { value: ConnectionDefinitionRuntime; expiresAt: number }>()

function getCached(key: string): ConnectionDefinitionRuntime | undefined {
  const entry = cache.get(key)
  if (entry && entry.expiresAt > Date.now()) return entry.value
  if (entry) cache.delete(key)
  return undefined
}

function setCached(key: string, value: ConnectionDefinitionRuntime): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS })
}

type RuntimeColumns = {
  connectionType: string | null
  authApply: AuthApply | null
  baseUrlTemplate: string | null
  global: boolean | null
}

function toRuntime(row: RuntimeColumns): ConnectionDefinitionRuntime {
  return {
    connectionType: row.connectionType,
    authApply: row.authApply,
    baseUrlTemplate: row.baseUrlTemplate,
    global: row.global ?? false,
  }
}

async function lookup(
  key: string,
  find: () => Promise<RuntimeColumns | undefined>
): Promise<ConnectionDefinitionRuntime | undefined> {
  const cached = getCached(key)
  if (cached) return cached

  const row = await find()
  if (!row) return undefined

  const value = toRuntime(row)
  setCached(key, value)
  return value
}

const RUNTIME_COLUMNS = {
  connectionType: true,
  authApply: true,
  baseUrlTemplate: true,
  global: true,
} as const

/** Definition runtime fields by ConnectionDefinition.id (the credential's FK). */
export async function getDefinitionRuntimeById(
  definitionId: string
): Promise<ConnectionDefinitionRuntime | undefined> {
  return lookup(`id:${definitionId}`, () =>
    database.query.ConnectionDefinition.findFirst({
      where: (d, { eq }) => eq(d.id, definitionId),
      columns: RUNTIME_COLUMNS,
    })
  )
}

/** Definition runtime fields for an MCP-server-owned definition. */
export async function getDefinitionRuntimeByMcpServerId(
  mcpServerId: string
): Promise<ConnectionDefinitionRuntime | undefined> {
  return lookup(`mcp:${mcpServerId}`, () =>
    database.query.ConnectionDefinition.findFirst({
      where: (d, { eq }) => eq(d.mcpServerId, mcpServerId),
      columns: RUNTIME_COLUMNS,
    })
  )
}

/** Definition runtime fields for a platform built-in provider (gmail, outlook, postgres, …). */
export async function getDefinitionRuntimeByProviderKey(
  providerKey: string
): Promise<ConnectionDefinitionRuntime | undefined> {
  return lookup(`provider:${providerKey}`, () =>
    database.query.ConnectionDefinition.findFirst({
      where: (d, { eq }) => eq(d.providerKey, providerKey),
      columns: RUNTIME_COLUMNS,
    })
  )
}

/** Test-only escape hatch. */
export function clearConnectionDefinitionRuntimeCache(): void {
  cache.clear()
}
