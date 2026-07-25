// packages/lib/src/evals/editor-support.ts
//
// Server-side support for the Simulation case editor's tool-responses section.
// The displayed tool list is now derived client-side from the enriched unified
// catalog (`useToolGroups` over `buildCatalogTreeFromInstallations` — see
// plans/mcp/v4/tool-catalog-unification.md); this module keeps the two pieces
// that need the real Zod `outputSchema` (non-serializable, never crosses the
// wire): mock validation (`eval.validateMock` + Kopilot's
// `update_eval_case_mock`) and the suggester's tool projection.

import { isToolVisibleOn, toolCategory } from '../agents/tool-visibility'
import { buildAgentCapabilityRegistry } from '../ai/agent-framework/effective-runtime'
import type { AgentToolDefinition, ToolCategory } from '../ai/agent-framework/types'
import { scaffoldFromSchema, validateMockOutput } from './simulation/mock-tools'
import { getToolExampleOutput } from './tool-examples'

/**
 * Internal server projection of one effective tool — consumed by the eval
 * suggester (`suggestions.ts`), which feeds it to the suggestion LLM. No
 * longer crosses the wire: the case editor's displayed list comes from the
 * enriched client catalog instead.
 */
export interface EditorToolEntry {
  name: string
  displayName: string
  description: string
  /**
   * Visibility class. `control` tools are dropped before this projection;
   * only `capability` and `system` survive.
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
 * Validate one authored mock output against its tool's declared `outputSchema`.
 *
 * Looks the tool up in the UNFILTERED installed-tool universe (the capability
 * registry without `filterToolsByToolsets`) — deliberately broader than the
 * agent's current toolset, so a mock authored ahead of time for a tool the
 * agent doesn't have yet ("Add tool" forward-authoring) still validates
 * against its real schema.
 */
export async function validateAgentToolMock(input: {
  organizationId: string
  userId: string
  agentId: string
  toolName: string
  output: unknown
}): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const registry = await buildAgentCapabilityRegistry({
    organizationId: input.organizationId,
    userId: input.userId,
    sessionId: `eval-editor-${input.agentId}`,
    agentId: input.agentId,
    // Mock-output schema validation only — the UNFILTERED tool universe is the
    // point here (a mock authored for a tool the agent doesn't have yet must still
    // validate against its real schema). No execution, nothing to authorize.
    capabilities: undefined,
  })
  const tool = registry.getTools('__none__').find((t) => t.name === input.toolName)
  if (!tool) {
    return { ok: false, error: `Tool "${input.toolName}" is not installed in this organization` }
  }
  return validateMockOutput(tool, input.output)
}
