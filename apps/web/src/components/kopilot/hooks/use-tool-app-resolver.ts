// apps/web/src/components/kopilot/hooks/use-tool-app-resolver.ts

'use client'

import { useMemo } from 'react'
import {
  type AppInstallation,
  useExtensionsContext,
} from '~/providers/extensions/extensions-context'

export interface ResolvedTool {
  /** Snake-case tool name as streamed in `ToolCallPart.name`. */
  toolName: string
  installation: AppInstallation
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
 * Resolves a kopilot `ToolCallPart.name` to the installed app that owns it,
 * so the tool-status pill can render `<AppIcon>` instead of a generic
 * Lucide fallback.
 *
 * The map is built over `useExtensionsContext().appInstallations`, which is
 * already loaded once per session by `ExtensionsProvider` (a hard
 * dependency of `(protected)/app` layout). Each cached tool carries a
 * pre-resolved `registeredName` and `iconId` — see
 * `packages/lib/src/cache/providers/installed-apps-provider.ts` — so this
 * hook performs no string manipulation and has no knowledge of the
 * bridge's encoding (decision D1).
 *
 * Built-in tools (find_threads, search_kb, …) resolve through the synthetic
 * Auxx.ai row prepended by `installedAppsProvider`; the pill renders them
 * with the toolset's iconKey (falling back to the auxx logo). See
 * `plans/kopilot/agents/tools/project-builtin-auxx-into-installations.md`.
 */
export function useToolAppResolver() {
  const { appInstallations } = useExtensionsContext()

  const toolMap = useMemo(() => {
    const map = new Map<string, ResolvedTool>()
    for (const installation of appInstallations) {
      for (const tool of installation.agentTools ?? []) {
        map.set(tool.registeredName, {
          toolName: tool.registeredName,
          installation,
          iconId: tool.iconId,
          color: undefined,
          displayName: tool.name,
          appTitle: installation.app.title,
        })
      }
    }
    return map
  }, [appInstallations])

  return {
    toolMap,
    resolve: (toolName: string): ResolvedTool | undefined => toolMap.get(toolName),
  }
}
