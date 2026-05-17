// apps/web/src/components/agents/ui/detail/tools/use-toolset-mutations.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useRef } from 'react'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../../store/agent-store'

interface UseToolsetMutationsReturn {
  toggleToolset: (slug: string, enabled: boolean) => Promise<void>
  toggleToolsets: (changes: Array<{ slug: string; enabled: boolean }>) => Promise<void>
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

  const applyOptimisticChange = (
    toolsets: AgentDetail['toolsets'],
    slug: string,
    enabled: boolean
  ): AgentDetail['toolsets'] => {
    const idx = toolsets.findIndex((t) => t.slug === slug)
    if (idx >= 0) {
      const current = toolsets[idx]
      if (!current) return toolsets
      const next = [...toolsets]
      next[idx] = {
        ...current,
        enabled,
        source: current.source === 'auto_default' ? 'manual' : current.source,
      }
      return next
    }
    return [
      ...toolsets,
      {
        slug,
        enabled,
        source: 'manual',
        config: {},
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
        return { ...old, toolsets: applyOptimisticChange(old.toolsets, slug, enabled) }
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
          toolsets = applyOptimisticChange(toolsets, slug, enabled)
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

  return { toggleToolset, toggleToolsets, isPending: update.isPending }
}
