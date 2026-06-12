// apps/web/src/components/agents/ui/detail/tools/use-toolset-mutations.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useRef } from 'react'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../../store/agent-store'

/** Patch shape mirroring the server's `AgentToolsetPatch` — both fields optional. */
export interface ToolsetPatch {
  enabled?: boolean
  /** Registered tool names disabled inside this toolset (full replace). */
  disabledTools?: string[]
}

interface UseToolsetMutationsReturn {
  toggleToolset: (slug: string, enabled: boolean) => Promise<void>
  toggleToolsets: (changes: Array<{ slug: string; enabled: boolean }>) => Promise<void>
  /**
   * Patch a single toolset's `enabled` flag and/or its `config.disabledTools`
   * deny-list in one optimistic mutation. Backs per-tool MCP selection — the
   * caller computes the next deny-list from the tool checkboxes.
   */
  updateToolset: (slug: string, patch: ToolsetPatch) => Promise<void>
  isPending: boolean
}

/**
 * Per-agent toolset mutations with optimistic updates against the
 * `agent.getById` cache. The optimistic write mirrors the server's exact
 * response (enabled flag + `auto_default → manual` source promotion), so we
 * don't invalidate on success — only roll back on error.
 *
 * The `agentSlug` param is required because `AgentDetailLoader` subscribes to
 * `agent.getById` by slug (from the URL), so optimistic writes must target
 * the slug-keyed cache entry — not the UUID-keyed one.
 */
export function useToolsetMutations(
  agentId: string,
  agentSlug: string,
  onSavingChange?: (saving: boolean) => void
): UseToolsetMutationsReturn {
  const utils = api.useUtils()
  const update = api.agentToolset.update.useMutation()
  const savingTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const applyOptimisticPatch = (
    toolsets: AgentDetail['toolsets'],
    slug: string,
    patch: ToolsetPatch
  ): AgentDetail['toolsets'] => {
    const idx = toolsets.findIndex((t) => t.slug === slug)
    if (idx >= 0) {
      const current = toolsets[idx]
      if (!current) return toolsets
      const next = [...toolsets]
      next[idx] = {
        ...current,
        enabled: patch.enabled ?? current.enabled,
        source: current.source === 'auto_default' ? 'manual' : current.source,
        config:
          patch.disabledTools !== undefined
            ? { ...current.config, disabledTools: patch.disabledTools }
            : current.config,
      }
      return next
    }
    return [
      ...toolsets,
      {
        slug,
        enabled: patch.enabled ?? true,
        source: 'manual',
        config: patch.disabledTools !== undefined ? { disabledTools: patch.disabledTools } : {},
      },
    ]
  }

  const toggleToolset = useCallback(
    async (slug: string, enabled: boolean) => {
      // Show "Saving…" only if the mutation is still in-flight after 400 ms.
      savingTimerRef.current = setTimeout(() => onSavingChange?.(true), 400)

      const previous = utils.agent.getById.getData({ agentId: agentSlug })

      utils.agent.getById.setData({ agentId: agentSlug }, (old) => {
        if (!old) return old
        return { ...old, toolsets: applyOptimisticPatch(old.toolsets, slug, { enabled }) }
      })

      try {
        await update.mutateAsync({ agentId, slug, enabled })
      } catch (err) {
        utils.agent.getById.setData({ agentId: agentSlug }, previous)
        toastError({
          title: 'Failed to update toolset',
          description: err instanceof Error ? err.message : 'Unknown error',
        })
      } finally {
        clearTimeout(savingTimerRef.current)
        onSavingChange?.(false)
      }
    },
    [agentId, agentSlug, onSavingChange, update, utils.agent.getById]
  )

  /**
   * Patch one toolset's `enabled` flag and/or `disabledTools` deny-list. One
   * optimistic write mirroring the server's `applyToolsetPatch`, then a single
   * mutation — no invalidate on success.
   */
  const updateToolset = useCallback(
    async (slug: string, patch: ToolsetPatch) => {
      savingTimerRef.current = setTimeout(() => onSavingChange?.(true), 400)

      const previous = utils.agent.getById.getData({ agentId: agentSlug })

      utils.agent.getById.setData({ agentId: agentSlug }, (old) => {
        if (!old) return old
        return { ...old, toolsets: applyOptimisticPatch(old.toolsets, slug, patch) }
      })

      try {
        await update.mutateAsync({ agentId, slug, ...patch })
      } catch (err) {
        utils.agent.getById.setData({ agentId: agentSlug }, previous)
        toastError({
          title: 'Failed to update toolset',
          description: err instanceof Error ? err.message : 'Unknown error',
        })
      } finally {
        clearTimeout(savingTimerRef.current)
        onSavingChange?.(false)
      }
    },
    [agentId, agentSlug, onSavingChange, update, utils.agent.getById]
  )

  /**
   * Bulk variant. Applies one combined optimistic write and fires all
   * mutations in parallel. No invalidate — the optimistic write already
   * mirrors the server response.
   */
  const toggleToolsets = useCallback(
    async (changes: Array<{ slug: string; enabled: boolean }>) => {
      if (changes.length === 0) return

      savingTimerRef.current = setTimeout(() => onSavingChange?.(true), 400)
      const previous = utils.agent.getById.getData({ agentId: agentSlug })

      utils.agent.getById.setData({ agentId: agentSlug }, (old) => {
        if (!old) return old
        let toolsets = old.toolsets
        for (const { slug, enabled } of changes) {
          toolsets = applyOptimisticPatch(toolsets, slug, { enabled })
        }
        return { ...old, toolsets }
      })

      try {
        await Promise.all(
          changes.map(({ slug, enabled }) => update.mutateAsync({ agentId, slug, enabled }))
        )
      } catch (err) {
        utils.agent.getById.setData({ agentId: agentSlug }, previous)
        toastError({
          title: 'Failed to update toolsets',
          description: err instanceof Error ? err.message : 'Unknown error',
        })
      } finally {
        clearTimeout(savingTimerRef.current)
        onSavingChange?.(false)
      }
    },
    [agentId, agentSlug, onSavingChange, update, utils.agent.getById]
  )

  return { toggleToolset, toggleToolsets, updateToolset, isPending: update.isPending }
}
