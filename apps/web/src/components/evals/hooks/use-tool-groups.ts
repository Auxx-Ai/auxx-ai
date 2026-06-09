// apps/web/src/components/evals/hooks/use-tool-groups.ts
'use client'

import { useMemo } from 'react'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'

type EditorToolEntry = RouterOutputs['eval']['agentToolset']['tools'][number]

/** A toolset group with its effective tools joined back in + a system flag. */
export interface EditorToolGroup {
  slug: string
  /** Human toolset label for the group header (falls back to the slug). */
  fullLabel: string
  /** Resolved icon — the toolset's pre-cascaded `iconId` from the cache. */
  iconId: string
  color: string
  /** Effective tools in this toolset, in `eval.agentToolset` order. */
  tools: EditorToolEntry[]
  /** True when every member tool is a platform `system` read — collapse by default. */
  isSystem: boolean
}

/** A tool's owning toolset label + resolved icon, keyed by `registeredName`. */
export interface ToolMetaEntry {
  toolsetLabel: string
  iconId: string
}

/**
 * The agent's effective toolset, grouped by toolset for the eval case editor.
 * Sourced from `appInstallations` (the org-cache projection) keyed by each
 * tool's `registeredName` — the exact LLM-facing name the effective toolset
 * (`eval.agentToolset`) reports, for built-in AND app tools alike. This is the
 * same data and key `useToolAppResolver` (the kopilot pill) uses, so the eval
 * editor and the pill resolve to the same icon. Each tool's `iconId` is the
 * cache's pre-resolved cascade (toolset.iconKey → app.avatarUrl → 'package'),
 * so we never re-implement it here.
 *
 * `groups`/`ungroupedTools` drive the Tool responses tree; `index` resolves a
 * tool name → its toolset label/icon for the assertion picker. Capability
 * groups sort before `system` groups; tools absent from the cache fall into
 * `ungroupedTools` (rendered as an "Other" bucket) rather than being dropped.
 */
export function useToolGroups(agentId: string): {
  groups: EditorToolGroup[]
  ungroupedTools: EditorToolEntry[]
  index: Map<string, ToolMetaEntry>
  isLoading: boolean
} {
  const { appInstallations, isLoading: appsLoading } = useExtensionsContext()
  const toolsetQuery = api.eval.agentToolset.useQuery({ agentId })

  return useMemo(() => {
    // Per-tool meta keyed by `registeredName` (matches the effective toolset's
    // tool `name`), plus per-toolset header meta keyed by slug.
    const toolMeta = new Map<string, { toolsetSlug: string; iconId: string }>()
    const toolsetMeta = new Map<string, { fullLabel: string; color: string }>()
    for (const inst of appInstallations) {
      for (const ts of inst.agentToolsets ?? []) {
        if (!toolsetMeta.has(ts.slug)) {
          toolsetMeta.set(ts.slug, { fullLabel: ts.name, color: ts.color ?? '' })
        }
      }
      for (const tool of inst.agentTools ?? []) {
        if (!toolMeta.has(tool.registeredName)) {
          toolMeta.set(tool.registeredName, {
            toolsetSlug: tool.toolsetSlug,
            iconId: tool.iconId,
          })
        }
      }
    }

    const tools = toolsetQuery.data?.tools ?? []

    // Bucket effective tools by owning toolset; cache-miss tools fall into "Other".
    const bySlug = new Map<string, EditorToolEntry[]>()
    const ungroupedTools: EditorToolEntry[] = []
    for (const tool of tools) {
      const meta = toolMeta.get(tool.name)
      if (!meta) {
        ungroupedTools.push(tool)
        continue
      }
      const arr = bySlug.get(meta.toolsetSlug) ?? []
      arr.push(tool)
      bySlug.set(meta.toolsetSlug, arr)
    }

    const groups: EditorToolGroup[] = [...bySlug.entries()].map(([slug, groupTools]) => ({
      slug,
      fullLabel: toolsetMeta.get(slug)?.fullLabel ?? slug,
      // Every tool in a toolset shares the same cascaded icon, so any member's
      // iconId is the group icon (matches what the kopilot pill renders).
      iconId: toolMeta.get(groupTools[0].name)?.iconId ?? 'wrench',
      color: toolsetMeta.get(slug)?.color ?? '',
      tools: groupTools,
      isSystem: groupTools.every((t) => t.category === 'system'),
    }))
    // System groups sink to the bottom; alpha within each band.
    groups.sort((a, b) => {
      if (a.isSystem !== b.isSystem) return Number(a.isSystem) - Number(b.isSystem)
      return a.fullLabel.localeCompare(b.fullLabel)
    })

    // Tool name → toolset label + icon, for the assertion picker (no grouped
    // options) — built from the same meta so app tools resolve correctly.
    const index = new Map<string, ToolMetaEntry>()
    for (const [name, meta] of toolMeta) {
      index.set(name, {
        toolsetLabel: toolsetMeta.get(meta.toolsetSlug)?.fullLabel ?? meta.toolsetSlug,
        iconId: meta.iconId,
      })
    }

    return {
      groups,
      ungroupedTools,
      index,
      isLoading: appsLoading || toolsetQuery.isLoading,
    }
  }, [appInstallations, appsLoading, toolsetQuery.data, toolsetQuery.isLoading])
}
