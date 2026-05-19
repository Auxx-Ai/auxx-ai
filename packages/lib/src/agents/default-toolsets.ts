// packages/lib/src/agents/default-toolsets.ts

import { BUILTIN_TOOLSETS } from './builtin-app'

/**
 * Built-in default toolset slugs — every `BUILTIN_TOOLSETS` row with
 * `isDefault: true`. Each agent created without an explicit `toolsetSlugs`
 * payload gets one `Agent.toolsets[]` entry per slug with
 * `source = 'auto_default'`.
 */
export const BUILTIN_DEFAULT_TOOLSETS: ReadonlyArray<string> = BUILTIN_TOOLSETS.filter(
  (t) => t.isDefault
).map((t) => t.slug)

/**
 * Resolve the default-on toolset slugs for a new agent in this org. Only the
 * built-in `Auxx.ai` toolsets seed onto new agents; installed third-party app
 * toolsets are never auto-added, regardless of their SDK `isDefault` flag —
 * users add them explicitly from the tool picker.
 */
export async function resolveDefaultToolsets(_orgId: string): Promise<string[]> {
  return [...BUILTIN_DEFAULT_TOOLSETS]
}
