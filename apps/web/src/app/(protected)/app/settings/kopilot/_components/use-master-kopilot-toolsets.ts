// apps/web/src/app/(protected)/app/settings/kopilot/_components/use-master-kopilot-toolsets.ts
'use client'

import type { CatalogNode, CatalogToolsetNode, ToolsetEntry } from '@auxx/lib/agents/client'
import { useMemo } from 'react'
import { useSettings } from '~/hooks/use-settings'

/**
 * Read + write Kopilot's org-wide toolset state. Mirrors what
 * `useToolsetMutations` does for an agent, but writes the full
 * `kopilot.toolsets` array via `updateOrganizationSetting` instead of
 * per-slug `agentToolset.update`. Glob entries (e.g. `auxx:*`) are
 * expanded for the rendering layer and materialized on first toggle so
 * the stored array is always a literal record of admin intent.
 */
export function useMasterKopilotToolsets(catalog: CatalogNode[]) {
  const { getSetting, updateOrganizationSetting, isUpdatingOrgSetting } = useSettings({
    scope: 'KOPILOT',
  })

  const stored = (getSetting('kopilot.toolsets') as ToolsetEntry[] | null) ?? []
  const appAccounts =
    (getSetting('kopilot.appAccounts') as Record<string, { credId: string } | undefined> | null) ??
    {}

  const allSlugs = useMemo(() => collectAllToolsetSlugs(catalog), [catalog])
  const effective = useMemo(() => expandWildcards(stored, allSlugs), [stored, allSlugs])

  const writeToolsets = (next: ToolsetEntry[]) =>
    updateOrganizationSetting('kopilot.toolsets', next, false)

  return {
    /** Wildcard-expanded entry list — feed this into `stateBySlug`. */
    effective,
    appAccounts,
    isSaving: isUpdatingOrgSetting,

    toggleToolset: async (slug: string, enabled: boolean) => {
      const materialized = materializeOnFirstToggle(stored, allSlugs)
      await writeToolsets(upsertToggle(materialized, slug, enabled))
    },
    toggleToolsets: async (changes: Array<{ slug: string; enabled: boolean }>) => {
      const materialized = materializeOnFirstToggle(stored, allSlugs)
      const next = changes.reduce((acc, c) => upsertToggle(acc, c.slug, c.enabled), materialized)
      await writeToolsets(next)
    },
    bindAppAccount: async (appId: string, credId: string) => {
      await updateOrganizationSetting(
        'kopilot.appAccounts',
        { ...appAccounts, [appId]: { credId } },
        false
      )
    },
  }
}

function collectAllToolsetSlugs(nodes: CatalogNode[]): string[] {
  const out: string[] = []
  const walk = (n: CatalogNode) => {
    if (n.kind === 'toolset') {
      out.push(n.slug)
      return
    }
    n.children.forEach(walk)
  }
  nodes.forEach(walk)
  return out
}

/**
 * Replace any wildcard entry (`auxx:*`) with concrete entries for each
 * matching registered slug. Specific entries override the wildcard
 * (most-specific-wins).
 */
export function expandWildcards(
  entries: ToolsetEntry[],
  registeredSlugs: string[]
): ToolsetEntry[] {
  const specific = new Set(entries.filter((e) => !e.slug.endsWith('*')).map((e) => e.slug))
  const out: ToolsetEntry[] = []
  for (const entry of entries) {
    if (entry.slug.endsWith('*')) {
      const prefix = entry.slug.slice(0, -1)
      for (const slug of registeredSlugs) {
        if (slug.startsWith(prefix) && !specific.has(slug)) {
          out.push({
            slug,
            enabled: entry.enabled,
            source: entry.source,
            config: {},
          })
        }
      }
    } else {
      out.push(entry)
    }
  }
  return out
}

/**
 * If the stored list contains any wildcard, return the fully-expanded list
 * (no wildcard) so subsequent toggles can write a stable concrete record.
 */
export function materializeOnFirstToggle(
  entries: ToolsetEntry[],
  registeredSlugs: string[]
): ToolsetEntry[] {
  const hasWildcard = entries.some((e) => e.slug.endsWith('*'))
  if (!hasWildcard) return entries
  return expandWildcards(entries, registeredSlugs)
}

export function upsertToggle(list: ToolsetEntry[], slug: string, enabled: boolean): ToolsetEntry[] {
  const idx = list.findIndex((e) => e.slug === slug)
  if (idx === -1) {
    return [...list, { slug, enabled, source: 'manual', config: {} }]
  }
  const next = list.slice()
  const prev = next[idx]!
  next[idx] = { ...prev, enabled, source: 'manual' }
  return next
}

/** Test helper — discover slugs under a catalog tree. */
export function _collectToolsetNodesForTest(nodes: CatalogNode[]): CatalogToolsetNode[] {
  const out: CatalogToolsetNode[] = []
  const walk = (n: CatalogNode) => {
    if (n.kind === 'toolset') {
      out.push(n)
      return
    }
    n.children.forEach(walk)
  }
  nodes.forEach(walk)
  return out
}
