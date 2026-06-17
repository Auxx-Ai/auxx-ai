// apps/web/src/components/kopilot/hooks/use-tool-app-resolver.ts

'use client'

import {
  buildCatalogTreeFromInstallations,
  buildMcpCatalogNodes,
  flattenCatalogToToolsets,
} from '@auxx/lib/agents/client'
import { useMemo } from 'react'
import { type AppInstallation, useAppsContext } from '~/components/apps/providers/apps-context'

export interface ResolvedTool {
  /** Snake-case tool name as streamed in `ToolCallPart.name`. */
  toolName: string
  /** Stable owner id — `installation.app.id` for apps, the toolset slug for MCP servers. */
  appId: string
  /** The owning app installation; absent for MCP-server tools (which have no installation). */
  installation?: AppInstallation
  /** Ready-to-pass into `<AppIcon iconId={...} />`. */
  iconId: string
  /** Apps don't carry a color token today; reserved for future use. */
  color: string | undefined
  /** Human label, e.g. "Search Google Contacts". */
  displayName: string
  /** App title, e.g. "Google Contacts" — used for tooltips on the header stack. */
  appTitle: string
}

/**
 * Resolves a kopilot `ToolCallPart.name` to the installed app (or MCP server)
 * that owns it, so the tool-status pill can render `<AppIcon>` instead of a
 * generic Lucide fallback.
 *
 * Indexes the SAME unified catalog tree the Tools tab and pickers render
 * (`buildCatalogTreeFromInstallations` + `buildMcpCatalogNodes` over
 * `useAppsContext()`), so the pill resolves exactly the entries the
 * catalog produces — no bespoke merge, no MCP special-casing here. Tool keys
 * are the registered names (`registeredName` / `mcpToolName`), matching what
 * the LLM actually invokes; icons are the flattened catalog's pre-cascaded
 * per-toolset icon (toolset icon → app avatar → fallback glyph).
 */
export function useToolAppResolver() {
  const { appInstallations, mcpServers } = useAppsContext()

  const toolMap = useMemo(() => {
    const byAppId = new Map(appInstallations.map((inst) => [inst.app.id, inst]))
    const map = new Map<string, ResolvedTool>()
    const roots = [
      ...buildCatalogTreeFromInstallations(appInstallations),
      ...buildMcpCatalogNodes(mcpServers),
    ]
    for (const root of roots) {
      if (root.kind !== 'app') continue
      // App roots are `app:<appId>`; MCP roots use the toolset slug (`mcp:<serverId>`)
      // verbatim, which doubles as the pill's stable owner id.
      const isMcp = root.origin === 'mcp'
      const appId = isMcp ? root.id : root.id.slice('app:'.length)
      const installation = isMcp ? undefined : byAppId.get(appId)
      for (const toolset of flattenCatalogToToolsets([root])) {
        for (const tool of toolset.tools) {
          map.set(tool.name, {
            toolName: tool.name,
            appId,
            installation,
            iconId: toolset.iconId,
            color: undefined,
            displayName: tool.displayName,
            appTitle: root.label,
          })
        }
      }
    }
    return map
  }, [appInstallations, mcpServers])

  return {
    toolMap,
    resolve: (toolName: string): ResolvedTool | undefined => toolMap.get(toolName),
  }
}
