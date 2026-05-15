// packages/lib/src/agents/default-toolsets.ts

/**
 * Native default toolset slugs. Each agent created without an explicit
 * `toolsetSlugs` payload gets one `AgentToolset` row per slug with
 * `source = 'auto_default'`.
 *
 * Read/write parity matches phase-1-engine-and-api §1.1: search + write for
 * entities, threads + compose for mail, knowledge lookups, actors. KB and
 * task tools are excluded — opt-in per agent.
 */
export const NATIVE_DEFAULT_TOOLSETS: ReadonlyArray<string> = [
  'entities.search',
  'entities.write',
  'mail.threads',
  'mail.compose',
  'knowledge',
  'docs',
  'actors',
]

/**
 * Resolve the default-on toolset slugs for a new agent in this org.
 *
 * Today: returns the native default set verbatim. Apps-track will merge in
 * app-declared `isDefault: true` toolsets from `getCachedAppAiTools(orgId)`
 * once that catalog provider lands (see `plans/kopilot/apps/README.md` §4.4
 * and `plans/kopilot/agents/tool-loading-and-execution.md` §3 B1).
 */
export async function resolveDefaultToolsets(_orgId: string): Promise<string[]> {
  // TODO(apps): merge in app-declared defaults once appAiToolsProvider exists.
  return [...NATIVE_DEFAULT_TOOLSETS]
}
