// packages/lib/src/evals/tool-examples.ts

import type { AgentToolDefinition } from '../ai/agent-framework/types'

/**
 * Read a tool's declared example success output, regardless of whether it is a
 * native capability or an app-backed tool (both expose `exampleOutput` on the
 * built `AgentToolDefinition` — app tools carry it verbatim from the SDK
 * catalog through the kopilot bridge).
 *
 * Returns `undefined` when the tool has no example; the caller then falls back
 * to the other autofill sources (schema-scaffold / AI-generate / record). The
 * eval tool-response editor seeds a new mock from this when present, labels the
 * row "from example," and still validates it against `outputSchema`.
 *
 * See plans/evals/tool-example-outputs.md and plans/evals/phase-1-agent-simulation.md §1.6.
 */
export function getToolExampleOutput(tool: AgentToolDefinition): unknown | undefined {
  return tool.exampleOutput
}
