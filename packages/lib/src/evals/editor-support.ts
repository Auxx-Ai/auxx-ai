// packages/lib/src/evals/editor-support.ts
//
// Read-only support for the Simulation case editor's tool-responses section. The
// editor lists the agent's EFFECTIVE toolset (the same builder production and
// `prepare-run` use) and, per tool, offers schema-driven mock authoring:
// seed-from-example, scaffold-from-schema, and validate-on-save. `outputSchema`
// is a `z.ZodType` (non-serializable), so scaffolding and validation must happen
// server-side — the wire carries only JSON. See plans/evals/phase-1-agent-simulation.md
// §1.6 and ui-plan.md §"Tool responses".

import { isToolVisibleOn, toolCategory } from '../agents/tool-visibility'
import { buildEffectiveAgentRuntime } from '../ai/agent-framework/effective-runtime'
import type { AgentToolDefinition, ToolCategory } from '../ai/agent-framework/types'
import { getCachedAgentById } from '../cache'
import { scaffoldFromSchema, validateMockOutput } from './simulation/mock-tools'
import { getToolExampleOutput } from './tool-examples'

export interface EditorToolEntry {
  name: string
  displayName: string
  description: string
  /**
   * Visibility class. `control` tools are dropped before this projection; the
   * editor receives only `capability` and `system`. The UI collapses `system`
   * into a default-closed group ("run live against the subject record").
   */
  category: ToolCategory
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
 * Pure projection of an effective toolset into editor entries (mockEditor-visible
 * only): enough to list each tool, seed a mock (example → scaffold), and flag
 * read-only tools. Control tools are dropped. Schemas never cross the wire;
 * example/scaffold are precomputed here. Extracted so the suggester (which
 * resolves the runtime once for tools + `utilityModel` together) can reuse it
 * without re-resolving the runtime.
 */
export function projectEditorToolEntries(tools: AgentToolDefinition[]): EditorToolEntry[] {
  const entries = tools
    // Drop control tools — they have no meaningful mock and run unwrapped in sims.
    .filter((t) => isToolVisibleOn(t, 'mockEditor'))
    .map((t) => {
      const example = getToolExampleOutput(t)
      return {
        name: t.name,
        displayName: t.displayName,
        description: t.description,
        category: toolCategory(t),
        idempotent: t.idempotent ?? false,
        hasOutputSchema: t.outputSchema != null,
        example,
        scaffold:
          example === undefined && t.outputSchema ? scaffoldFromSchema(t.outputSchema) : undefined,
      }
    })
  // `capability` first, `system` after (the UI groups by toolset, but this is the
  // wire-order fallback); alpha within each band.
  return entries.sort((a, b) => {
    if (a.category !== b.category) return a.category === 'system' ? 1 : -1
    return a.displayName.localeCompare(b.displayName)
  })
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
  return projectEditorToolEntries(await resolveToolset(input))
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
