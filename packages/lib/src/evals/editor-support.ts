// packages/lib/src/evals/editor-support.ts
//
// Read-only support for the Simulation case editor's tool-responses section. The
// editor lists the agent's EFFECTIVE toolset (the same builder production and
// `prepare-run` use) and, per tool, offers schema-driven mock authoring:
// seed-from-example, scaffold-from-schema, and validate-on-save. `outputSchema`
// is a `z.ZodType` (non-serializable), so scaffolding and validation must happen
// server-side — the wire carries only JSON. See plans/evals/phase-1-agent-simulation.md
// §1.6 and ui-plan.md §"Tool responses".

import { buildEffectiveAgentRuntime } from '../ai/agent-framework/effective-runtime'
import type { AgentToolDefinition } from '../ai/agent-framework/types'
import { getCachedAgentById } from '../cache'
import { scaffoldFromSchema, validateMockOutput } from './simulation/mock-tools'
import { getToolExampleOutput } from './tool-examples'

export interface EditorToolEntry {
  name: string
  displayName: string
  description: string
  /** Read-only tools may run for real under `passthrough_readonly`. */
  idempotent: boolean
  hasOutputSchema: boolean
  /** Declared `exampleOutput`, if any — the preferred autofill seed. */
  example?: unknown
  /** Valid-shaped skeleton from `outputSchema`, used when there's no example. */
  scaffold?: unknown
}

/** Resolve the agent's effective toolset via the shared production runtime builder. */
async function resolveToolset(input: {
  organizationId: string
  userId: string
  agentId: string
}): Promise<AgentToolDefinition[]> {
  const agent = await getCachedAgentById(input.organizationId, input.agentId)
  const hasProcedures = (agent?.procedures ?? []).length > 0
  const runtime = await buildEffectiveAgentRuntime({
    organizationId: input.organizationId,
    userId: input.userId,
    sessionId: `eval-editor-${input.agentId}`,
    agentId: input.agentId,
    domain: 'kopilot',
    hasProcedures,
  })
  return runtime.tools
}

/**
 * The editor-facing projection of the agent's effective toolset: enough to list
 * each tool, seed a mock (example → scaffold), and flag read-only tools. Schemas
 * themselves never cross the wire; example/scaffold are precomputed here.
 */
export async function listAgentEffectiveTools(input: {
  organizationId: string
  userId: string
  agentId: string
}): Promise<EditorToolEntry[]> {
  const tools = await resolveToolset(input)
  return tools.map((t) => {
    const example = getToolExampleOutput(t)
    return {
      name: t.name,
      displayName: t.displayName,
      description: t.description,
      idempotent: t.idempotent ?? false,
      hasOutputSchema: t.outputSchema != null,
      example,
      scaffold:
        example === undefined && t.outputSchema ? scaffoldFromSchema(t.outputSchema) : undefined,
    }
  })
}

/** Validate one authored mock output against its tool's declared `outputSchema`. */
export async function validateAgentToolMock(input: {
  organizationId: string
  userId: string
  agentId: string
  toolName: string
  output: unknown
}): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const tools = await resolveToolset(input)
  const tool = tools.find((t) => t.name === input.toolName)
  if (!tool) {
    return { ok: false, error: `Tool "${input.toolName}" is not in the agent's toolset` }
  }
  return validateMockOutput(tool, input.output)
}
