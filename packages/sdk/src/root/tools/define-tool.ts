// packages/sdk/src/root/tools/define-tool.ts

import type { z } from 'zod/v4'
import type { ToolDefinition } from './types.js'

/** LLM tool name regex per Anthropic/OpenAI spec. */
const TOOL_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/

/**
 * Wrap a tool definition with type inference and runtime id validation.
 *
 * `inputs`/`outputs` are zod schemas — `execute` infers its parameter type
 * from `z.input<inputs>` and is checked against `z.output<outputs>`.
 *
 * The build scanner enforces additional discipline (description present,
 * `.refine` stripped, `.tool.server.ts` import for `execute`) that this helper
 * does not duplicate at runtime.
 *
 * See plans/kopilot/apps/README.md §4.2 and
 * plans/kopilot/apps/gog-calendar-overhaul.md §0.
 */
export function defineTool<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(
  tool: ToolDefinition<TInput, TOutput>
): ToolDefinition<TInput, TOutput> {
  if (!TOOL_ID_RE.test(tool.id)) {
    throw new Error(`defineTool: invalid id "${tool.id}" — must match ${TOOL_ID_RE.source}`)
  }

  if (tool.exampleOutput !== undefined) {
    const parsed = tool.outputs.safeParse(tool.exampleOutput)
    if (!parsed.success) {
      throw new Error(
        `defineTool: tool "${tool.id}" exampleOutput does not satisfy its outputs schema — ${parsed.error.message}`
      )
    }
    // JSON-serializability guard — examples ride the catalog jsonb, so a
    // circular ref / BigInt would only fail at deploy time without this.
    try {
      if (JSON.stringify(tool.exampleOutput) === undefined) {
        throw new Error('serializes to undefined (function or top-level undefined)')
      }
    } catch (err) {
      throw new Error(
        `defineTool: tool "${tool.id}" exampleOutput is not JSON-serializable — ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  }

  return tool
}
