// apps/web/src/components/evals/hooks/use-tool-icon-map.ts
'use client'

import { flattenCatalogToToolsets } from '@auxx/lib/agents/client'
import { useMemo } from 'react'
import { useToolCatalog } from '~/components/agents/hooks/use-tool-catalog'

export interface ToolIcon {
  /** Already-resolved icon id (toolset's own, falling back to its app ancestor). */
  iconId: string
  /** Resolved color, or empty string. */
  color: string
}

/**
 * Maps each tool `name` → its catalog icon (the owning toolset/app icon), so the
 * eval editor can show real app icons instead of a generic wrench. Built
 * client-side from the same installed-app catalog the Tools tab uses — no extra
 * round-trip; `AgentToolDefinition` itself carries no icon.
 */
export function useToolIconMap(): Map<string, ToolIcon> {
  const { catalog } = useToolCatalog()
  return useMemo(() => {
    const map = new Map<string, ToolIcon>()
    for (const toolset of flattenCatalogToToolsets(catalog)) {
      for (const tool of toolset.tools) {
        map.set(tool.name, { iconId: toolset.iconId, color: toolset.color })
      }
    }
    return map
  }, [catalog])
}
