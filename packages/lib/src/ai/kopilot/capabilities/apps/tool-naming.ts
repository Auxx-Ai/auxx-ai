// packages/lib/src/ai/kopilot/capabilities/apps/tool-naming.ts

/**
 * Single source of truth for the LLM-facing tool-name encoding used by the
 * Kopilot app bridge. Per decision D1 (plans/kopilot/agents/tool-loading-and-execution.md §5),
 * each app-backed tool is registered as `<appSlug>_<toolId>` with the slug
 * portion kebab→snake so the name stays portable across LLM providers and
 * collisions between two apps publishing the same `toolId` are impossible.
 *
 * Called by:
 *  - the bridge at registration time (packages/lib/src/ai/kopilot/capabilities/apps/index.ts)
 *  - the installed-apps cache projection, so the client can do a direct
 *    `Map<registeredName, ResolvedTool>` lookup without re-encoding
 *    (apps/web/src/components/kopilot/hooks/use-tool-app-resolver.ts).
 */
export function getRegisteredToolName(appSlug: string, toolId: string): string {
  const slugPrefix = appSlug.replace(/-/g, '_')
  return `${slugPrefix}_${toolId}`
}
