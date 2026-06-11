// apps/web/src/components/agents/ui/detail/bindings/hooks/use-tool-meta.ts
'use client'

import { buildMcpToolMetaEntries } from '@auxx/lib/agents/client'
import { useMemo } from 'react'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'
import type { AgentDetail } from '../../../../store/agent-store'

/**
 * Resolved metadata for one tool, keyed by its **registered name** (the
 * LLM-facing name, `<appSlug>_<toolId>`) — the same key used in the agent's
 * binding override map. Pulled from the installed-apps cache so the Bindings
 * UI can read a tool's parameter schema without a server round-trip.
 */
export interface ToolMeta {
  /** Binding-map key (`<appSlug>_<toolId>`) — also the catalog `name` and chip tail. */
  registeredName: string
  /** Human-friendly tool label. */
  displayName: string
  /** Resolved icon id (toolset iconKey → app avatar → 'package'). */
  iconId: string
  /** The toolset slug this tool belongs to — join key against `agent.toolsets`. */
  toolsetSlug: string
  /** The tool's `inputsJsonSchema` (JSON Schema `parameters`). */
  inputsJsonSchema: Record<string, unknown>
  /** Whether the tool is enabled on the agent (in an enabled toolset). */
  enabled: boolean
}

export interface UseToolMetaResult {
  /** Lookup keyed by registered name. */
  byRegisteredName: Map<string, ToolMeta>
  /** Registered names of tools in an enabled toolset — feeds the picker `filterNames`. */
  enabledToolNames: ReadonlySet<string>
  isLoading: boolean
}

/**
 * Build the tool-metadata lookups the Bindings UI needs from the installed-apps
 * cache + the agent's toolset state.
 *
 * Catalog chips, bindings, and the runtime toolset all key on the registered
 * name now, so `ToolReferenceList` emits `tool:<registeredName>` and the binding
 * map keys match without translation. This hook exposes each tool's parameter
 * schema keyed by that one name. See plans/kopilot/agents/tool-chip-registered-name.md.
 */
export function useToolMeta(agent: AgentDetail): UseToolMetaResult {
  const { appInstallations, mcpServers, isLoading } = useExtensionsContext()

  return useMemo(() => {
    const enabledToolsetSlugs = new Set(
      (agent.toolsets ?? []).filter((t) => t.enabled).map((t) => t.slug)
    )

    const byRegisteredName = new Map<string, ToolMeta>()
    const enabledToolNames = new Set<string>()

    for (const inst of appInstallations) {
      for (const tool of inst.agentTools ?? []) {
        const enabled = enabledToolsetSlugs.has(tool.toolsetSlug)
        const meta: ToolMeta = {
          registeredName: tool.registeredName,
          displayName: tool.name,
          iconId: tool.iconId,
          toolsetSlug: tool.toolsetSlug,
          inputsJsonSchema: (tool.inputsJsonSchema ?? {}) as Record<string, unknown>,
          enabled,
        }
        byRegisteredName.set(tool.registeredName, meta)
        if (enabled) enabledToolNames.add(tool.registeredName)
      }
    }

    // MCP tools resolve too (no parameter schema in the client projection → empty schema).
    for (const entry of buildMcpToolMetaEntries(mcpServers)) {
      const enabled = enabledToolsetSlugs.has(entry.toolsetSlug)
      byRegisteredName.set(entry.name, {
        registeredName: entry.name,
        displayName: entry.displayName,
        iconId: entry.iconId,
        toolsetSlug: entry.toolsetSlug,
        inputsJsonSchema: {},
        enabled,
      })
      if (enabled) enabledToolNames.add(entry.name)
    }

    return { byRegisteredName, enabledToolNames, isLoading }
  }, [appInstallations, mcpServers, agent.toolsets, isLoading])
}
