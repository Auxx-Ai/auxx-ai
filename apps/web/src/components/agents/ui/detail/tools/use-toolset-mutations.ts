// apps/web/src/components/agents/ui/detail/tools/use-toolset-mutations.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useCallback, useRef } from 'react'
import { api } from '~/trpc/react'
import type { AgentDetail } from '../../../store/agent-store'

interface ToolsetPatch {
  enabled?: boolean
  disabledTools?: string[]
}

interface UseToolsetMutationsReturn {
  toggleToolset: (slug: string, enabled: boolean) => Promise<void>
  toggleTool: (slug: string, toolName: string, enabled: boolean) => Promise<void>
  isPending: boolean
}

/**
 * Per-agent toolset mutations with optimistic updates against the
 * `agent.getById` cache. Both toggles fire `api.agentToolset.update` and
 * reconcile by invalidating the detail query on success / rolling back on
 * error.
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

  const applyPatch = useCallback(
    async (slug: string, patch: ToolsetPatch) => {
      // Show "Saving…" only if the mutation is still in-flight after 400 ms.
      savingTimerRef.current = setTimeout(() => onSavingChange?.(true), 400)

      const previous = utils.agent.getById.getData({ agentId: agentSlug })

      utils.agent.getById.setData({ agentId: agentSlug }, (old) => {
        if (!old) return old
        const toolsets = [...old.toolsets]
        const idx = toolsets.findIndex((t) => t.toolsetSlug === slug)
        if (idx >= 0) {
          const current = toolsets[idx]
          if (!current) return old
          const nextConfig = { ...(current.config ?? {}) }
          if (patch.disabledTools !== undefined) {
            nextConfig.disabledTools = patch.disabledTools
          }
          toolsets[idx] = {
            ...current,
            enabled: patch.enabled ?? current.enabled,
            config: nextConfig,
            source: current.source === 'auto_default' ? 'manual' : current.source,
          }
        } else {
          toolsets.push({
            id: `optimistic-${slug}`,
            agentId,
            toolsetSlug: slug,
            enabled: patch.enabled ?? true,
            source: 'manual',
            config: patch.disabledTools !== undefined ? { disabledTools: patch.disabledTools } : {},
            createdAt: new Date(),
            updatedAt: new Date(),
          } as AgentDetail['toolsets'][number])
        }
        return { ...old, toolsets }
      })

      try {
        await update.mutateAsync({ agentId, slug, ...patch })
        // Invalidate without a key so both slug-keyed and id-keyed entries refetch.
        await utils.agent.getById.invalidate()
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

  const toggleToolset = useCallback(
    (slug: string, enabled: boolean) => applyPatch(slug, { enabled }),
    [applyPatch]
  )

  const toggleTool = useCallback(
    async (slug: string, toolName: string, enabled: boolean) => {
      const current = utils.agent.getById.getData({ agentId: agentSlug })
      const existing = current?.toolsets.find((t) => t.toolsetSlug === slug)
      const currentDisabled = new Set<string>((existing?.config?.disabledTools as string[]) ?? [])
      if (enabled) {
        currentDisabled.delete(toolName)
      } else {
        currentDisabled.add(toolName)
      }
      await applyPatch(slug, { disabledTools: [...currentDisabled] })
    },
    [agentSlug, applyPatch, utils.agent.getById]
  )

  return { toggleToolset, toggleTool, isPending: update.isPending }
}
