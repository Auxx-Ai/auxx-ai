// packages/lib/src/ai/mcp/tool-schema.ts
// Persist an MCP tool's output schema / example on the per-org installation descriptor. Drives the
// schema editor's Save / Reset and "Save as example output" actions (build-plan phase 4).

import { database as db, type McpToolDescriptor, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import Ajv from 'ajv'
import { and, eq } from 'drizzle-orm'
import { onCacheEvent } from '../../cache/invalidate'

const logger = createScopedLogger('mcp-tool-schema')

// Tolerant ajv — the same posture as the adapter; `compile` still throws on a structurally broken
// schema, which is what we want to reject before persisting.
const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false })

export interface UpdateMcpToolSchemaResult {
  ok: boolean
  error?: string
}

/**
 * Partial-update one tool descriptor's output schema + example inside `McpInstallation.tools`.
 *
 * - `outputSchema`: an object **sets** it (source defaults to `'manual'` — sticky across refreshes);
 *   `null` **resets** it to none (dropping `outputSchemaSource`, so the next sync can adopt a
 *   server-declared schema); `undefined` leaves it untouched.
 * - `exampleOutput`: any provided value (incl. `null`) is stored; `clearExampleOutput` removes it.
 *
 * Fires `mcp.tools.synced` so the org cache reflects the change.
 */
export async function updateMcpToolSchema(opts: {
  organizationId: string
  serverId: string
  toolName: string
  outputSchema?: Record<string, unknown> | null
  source?: 'inferred' | 'manual'
  exampleOutput?: unknown
  clearExampleOutput?: boolean
}): Promise<UpdateMcpToolSchemaResult> {
  const { organizationId, serverId, toolName } = opts

  if (opts.outputSchema) {
    try {
      ajv.compile(opts.outputSchema)
    } catch (error) {
      return { ok: false, error: `Invalid schema: ${(error as Error).message}` }
    }
  }

  const install = await db.query.McpInstallation.findFirst({
    where: and(
      eq(schema.McpInstallation.organizationId, organizationId),
      eq(schema.McpInstallation.mcpServerId, serverId)
    ),
    columns: { id: true, tools: true },
  })
  if (!install) return { ok: false, error: 'Server is not installed for this organization.' }

  const tools = install.tools ?? []
  const idx = tools.findIndex((t) => t.name === toolName)
  if (idx === -1) return { ok: false, error: `Tool ${toolName} not found on this server.` }

  const next: McpToolDescriptor = { ...tools[idx]! }

  if (opts.outputSchema === null) {
    next.outputSchema = undefined
    next.outputSchemaSource = undefined
  } else if (opts.outputSchema) {
    next.outputSchema = opts.outputSchema
    next.outputSchemaSource = opts.source ?? 'manual'
  }

  if (opts.clearExampleOutput) {
    next.exampleOutput = undefined
  } else if (opts.exampleOutput !== undefined) {
    next.exampleOutput = opts.exampleOutput
  }

  const updated = tools.map((t, i) => (i === idx ? next : t))
  await db
    .update(schema.McpInstallation)
    .set({ tools: updated, updatedAt: new Date() })
    .where(eq(schema.McpInstallation.id, install.id))

  await onCacheEvent('mcp.tools.synced', { orgId: organizationId })
  logger.info('Updated MCP tool schema', { serverId, toolName, source: next.outputSchemaSource })
  return { ok: true }
}
