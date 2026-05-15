// packages/sdk/src/root/ai/index.ts

/**
 * @auxx/sdk/ai — author surface for app-backed AI tools.
 *
 * See plans/kopilot/apps/README.md (parent plan) and §4 (SDK additions).
 *
 * Usage:
 * ```ts
 * import { defineAiTool, refs, z } from '@auxx/sdk/ai'
 * import execute from './check-availability.ai.server'
 *
 * export const checkAvailability = defineAiTool({
 *   id: 'check_calendar_availability',
 *   name: 'Check calendar availability',
 *   description: 'Find available meeting times.',
 *   inputs:  z.object({ timeMin: z.string(), timeMax: z.string() }),
 *   outputs: z.object({ busy: z.array(z.object({ start: z.string(), end: z.string() })) }),
 *   config:  { requiresConnection: true, connectionScope: 'user', timeout: 15000 },
 *   execute,
 * })
 * ```
 *
 * Note: re-exports `zod/v4` (zod v4 syntax with `.meta()` for ref markers).
 */

export { z } from 'zod/v4'
export { defineAiTool } from './define-ai-tool.js'
export { type AuxxRefMeta, refs } from './refs.js'
export type {
  AiTool,
  AiToolConfig,
  AiToolExecuteContext,
  AiToolset,
  EntityRefKind,
} from './types.js'
