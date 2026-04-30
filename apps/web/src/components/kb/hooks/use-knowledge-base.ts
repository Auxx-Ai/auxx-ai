// apps/web/src/components/kb/hooks/use-knowledge-base.ts
'use client'

import type { KBDraftSettings } from '@auxx/lib/kb/client'
import { useEffect, useMemo } from 'react'
import { api } from '~/trpc/react'
import {
  getKnowledgeBaseStoreState,
  type KnowledgeBase,
  useKnowledgeBaseStore,
} from '../store/knowledge-base-store'

interface UseKnowledgeBaseResult {
  knowledgeBase: KnowledgeBase | undefined
  isLoading: boolean
}

/**
 * Returns a single knowledge base. Pulls from the store first; falls back to
 * fetching from tRPC and hydrating the store. The pending optimistic flat
 * update + pending draft patch are merged on top of the server row in a
 * `useMemo`, so the returned reference is stable across renders when none of
 * the underlying pieces have changed (avoids the React getSnapshot loop).
 */
export function useKnowledgeBase(id: string | null | undefined): UseKnowledgeBaseResult {
  const { data, isLoading } = api.kb.byId.useQuery(
    { id: id ?? '' },
    { enabled: !!id, staleTime: 5 * 60 * 1000 }
  )

  useEffect(() => {
    if (data) {
      getKnowledgeBaseStoreState().applyKnowledgeBaseFromServer(data as KnowledgeBase)
    }
  }, [data])

  const rawKb = useKnowledgeBaseStore((s) => (id ? s.knowledgeBasesById[id] : undefined))
  const optNew = useKnowledgeBaseStore((s) => (id ? s.optimisticNewKBs[id] : undefined))
  const isDeleted = useKnowledgeBaseStore((s) => (id ? s.optimisticDeleted.has(id) : false))
  const pendingFlat = useKnowledgeBaseStore((s) => (id ? s.pendingUpdates[id] : undefined))
  const pendingDraft = useKnowledgeBaseStore((s) => (id ? s.pendingDraftPatches[id] : undefined))

  const knowledgeBase = useMemo<KnowledgeBase | undefined>(() => {
    if (!id || isDeleted) return undefined
    let kb: KnowledgeBase | undefined = optNew ?? rawKb
    if (!kb) return undefined
    if (pendingFlat) kb = { ...kb, ...pendingFlat.optimistic }
    if (pendingDraft) {
      const baseDraft = (kb.draftSettings as KBDraftSettings | null) ?? {}
      kb = {
        ...kb,
        draftSettings: { ...baseDraft, ...pendingDraft.patch },
      } as KnowledgeBase
    }
    return kb
  }, [id, rawKb, optNew, isDeleted, pendingFlat, pendingDraft])

  return { knowledgeBase, isLoading }
}

export function useActiveKnowledgeBaseId(): string | null {
  return useKnowledgeBaseStore((s) => s.activeKnowledgeBaseId)
}
