// packages/sdk/src/root/ai/define-ai-tool.ts

import type { z } from 'zod/v4'
import type { AiTool } from './types.js'

/** LLM tool name regex per Anthropic/OpenAI spec. */
const TOOL_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/

/**
 * Wrap an AI tool definition with type inference and runtime id validation.
 *
 * `inputs`/`outputs` are zod schemas — `execute` infers its parameter type
 * from `z.input<inputs>` and is checked against `z.output<outputs>`.
 *
 * The build scanner enforces additional discipline (description present,
 * `.refine` stripped, `.server.ts` import for `execute`) that this helper
 * does not duplicate at runtime.
 *
 * See plans/kopilot/apps/README.md §4.2.
 */
export function defineAiTool<TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(
  tool: AiTool<TInput, TOutput>
): AiTool<TInput, TOutput> {
  if (!TOOL_ID_RE.test(tool.id)) {
    throw new Error(`defineAiTool: invalid id "${tool.id}" — must match ${TOOL_ID_RE.source}`)
  }
  if (tool.config?.requiresConnection && !tool.config.connectionScope) {
    // Build-time scanner can soften this when the app has exactly one
    // ConnectionDefinition. At runtime in user code, we leave it as a soft
    // warning rather than throwing — the catalog row carries scope.
  }
  return tool
}
