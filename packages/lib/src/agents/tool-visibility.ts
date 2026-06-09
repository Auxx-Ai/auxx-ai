// packages/lib/src/agents/tool-visibility.ts
//
// One source of truth for which tool categories are visible on which UI surface.
// Menus consult `isToolVisibleOn` — they never carry local name lists. The
// classification itself lives on each tool's declared `category` (see
// `ai/agent-framework/types.ts`); this module only encodes the policy table.
// See plans/evals/tool-visibility-plan.md.

import type { AgentToolDefinition, ToolCategory } from '../ai/agent-framework/types'

/** A user-facing place that lists tools and must apply visibility policy. */
export type ToolVisibilitySurface = 'mockEditor' | 'referencePicker' | 'toolsetSettings' | 'trace'

/**
 * Categories hidden per surface — the ONE policy table. `system` on `mockEditor`
 * is "collapsed group, not dropped" at the UI layer; the server projection still
 * carries system tools flagged so an authored mock is never lost. Control tools
 * are dropped wherever they appear (most surfaces never receive them — they have
 * no `toolsetSlug`, so the catalog omits them already).
 */
const HIDDEN_CATEGORIES: Record<ToolVisibilitySurface, readonly ToolCategory[]> = {
  mockEditor: ['control'],
  referencePicker: ['control'],
  toolsetSettings: ['control'],
  trace: ['control'],
}

/** A tool's category, defaulting to `'capability'` when unannotated. */
export function toolCategory(tool: Pick<AgentToolDefinition, 'category'>): ToolCategory {
  return tool.category ?? 'capability'
}

/** Whether `tool` should appear on `surface` under the visibility policy. */
export function isToolVisibleOn(
  tool: Pick<AgentToolDefinition, 'category'>,
  surface: ToolVisibilitySurface
): boolean {
  return !HIDDEN_CATEGORIES[surface].includes(toolCategory(tool))
}
