// packages/sdk/src/root/tools/index.ts

/**
 * @auxx/sdk/tools — author surface for app-backed tools (consumed by Kopilot).
 *
 * See plans/kopilot/apps/README.md (parent plan) and §4 (SDK additions).
 *
 * Usage:
 * ```ts
 * import { defineTool, refs, z } from '@auxx/sdk/tools'
 * import execute from './check-availability.tool.server'
 *
 * export const checkAvailability = defineTool({
 *   id: 'check_calendar_availability',
 *   name: 'Check calendar availability',
 *   description: 'Find available meeting times.',
 *   inputs:  z.object({ timeMin: z.string(), timeMax: z.string() }),
 *   outputs: z.object({ busy: z.array(z.object({ start: z.string(), end: z.string() })) }),
 *   config:  { requiresConnection: true, timeout: 15000 },
 *   execute,
 * })
 * ```
 *
 * Note: re-exports `zod/v4` (zod v4 syntax with `.meta()` for ref markers).
 */

export { z } from 'zod/v4'
export { defineTool } from './define-tool.js'
export { type AuxxRefMeta, refs } from './refs.js'
export type {
  EntityRefKind,
  ToolActionContext,
  ToolActionEntity,
  ToolActionParticipant,
  ToolActionSurface,
  ToolAgentSurface,
  ToolConfig,
  ToolDefinition,
  ToolExecuteContext,
  Toolset,
} from './types.js'
