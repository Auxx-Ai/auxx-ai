// apps/web/src/components/agents/ui/detail/restrictions/hooks/use-tool-meta.ts
'use client'

import { useMemo } from 'react'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'
import type { AgentDetail } from '../../../../store/agent-store'

/** One identity-scoped arg the engine fail-closes on for a visitor turn. */
export interface IdentityScopedInput {
  name: string
  suggestedVar?: string
}

/**
 * Resolved metadata for one tool, keyed by its **registered name** (the
 * LLM-facing name, `<appSlug>_<toolId>`) — the same key used in
 * `Agent.toolRestrictions`. Pulled from the installed-apps cache so the
 * restrictions UI can read a tool's parameter schema + identity args without a
 * server round-trip.
 */
export interface ToolMeta {
  /** Restriction-map key (`<appSlug>_<toolId>`). */
  registeredName: string
  /** Catalog `name` for selection — what `ToolReferenceList` emits as `tool:<name>`. */
  catalogName: string
  /** Human-friendly tool label. */
  displayName: string
  /** Resolved icon id (toolset iconKey → app avatar → 'package'). */
  iconId: string
  /** The toolset slug this tool belongs to — join key against `agent.toolsets`. */
  toolsetSlug: string
  /** The tool's `inputsJsonSchema` (JSON Schema `parameters`). */
  inputsJsonSchema: Record<string, unknown>
  /** Args the author marked identity-scoped (chat fail-closes when unbound). */
  identityScopedInputs: IdentityScopedInput[]
  /** Whether the tool is enabled on the agent (in an enabled toolset). */
  enabled: boolean
}

export interface UseToolMetaResult {
  /** Lookup keyed by registered name. */
  byRegisteredName: Map<string, ToolMeta>
  /** Lookup keyed by catalog name (`tool.id`) → registered name, for the dialog. */
  registeredNameByCatalogName: Map<string, string>
  /** Catalog names of tools in an enabled toolset — feeds the picker `filterNames`. */
  enabledCatalogNames: ReadonlySet<string>
  isLoading: boolean
}

/**
 * Build the tool-metadata lookups the Restrictions UI needs from the
 * installed-apps cache + the agent's toolset state.
 *
 * `ToolReferenceList` emits `tool:<catalogName>` where `catalogName` is the
 * raw tool id; restrictions are keyed by the registered name. This hook bridges
 * the two and exposes each tool's parameter schema + identity args. See
 * plans/chat/v6 phase-4.
 */
export function useToolMeta(agent: AgentDetail): UseToolMetaResult {
  const { appInstallations, isLoading } = useExtensionsContext()

  return useMemo(() => {
    const enabledToolsetSlugs = new Set(
      (agent.toolsets ?? []).filter((t) => t.enabled).map((t) => t.slug)
    )

    const byRegisteredName = new Map<string, ToolMeta>()
    const registeredNameByCatalogName = new Map<string, string>()
    const enabledCatalogNames = new Set<string>()

    for (const inst of appInstallations) {
      for (const tool of inst.agentTools ?? []) {
        const enabled = enabledToolsetSlugs.has(tool.toolsetSlug)
        const meta: ToolMeta = {
          registeredName: tool.registeredName,
          catalogName: tool.id,
          displayName: tool.name,
          iconId: tool.iconId,
          toolsetSlug: tool.toolsetSlug,
          inputsJsonSchema: (tool.inputsJsonSchema ?? {}) as Record<string, unknown>,
          identityScopedInputs: [...(tool.identityScopedInputs ?? [])],
          enabled,
        }
        byRegisteredName.set(tool.registeredName, meta)
        registeredNameByCatalogName.set(tool.id, tool.registeredName)
        if (enabled) enabledCatalogNames.add(tool.id)
      }
    }

    return { byRegisteredName, registeredNameByCatalogName, enabledCatalogNames, isLoading }
  }, [appInstallations, agent.toolsets, isLoading])
}
