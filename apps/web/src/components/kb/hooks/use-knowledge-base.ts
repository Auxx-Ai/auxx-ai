// apps/web/src/components/kb/hooks/use-knowledge-base.ts
'use client'

import { useEffect } from 'react'
import { useShallow } from 'zustand/shallow'
import { api } from '~/trpc/react'
import {
  getKnowledgeBaseStoreState,
  type KnowledgeBase,
  selectEffectiveKnowledgeBase,
  useKnowledgeBaseStore,
} from '../store/knowledge-base-store'

interface UseKnowledgeBaseResult {
  knowledgeBase: KnowledgeBase | undefined
  isLoading: boolean
}

/**
 * Returns a single knowledge base. Pulls from the store first; falls back to
 * fetching from tRPC and hydrating the store.
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

  const knowledgeBase = useKnowledgeBaseStore(
    useShallow((state) => (id ? selectEffectiveKnowledgeBase(state, id) : undefined))
  )

  return { knowledgeBase, isLoading }
}

export function useActiveKnowledgeBaseId(): string | null {
  return useKnowledgeBaseStore((s) => s.activeKnowledgeBaseId)
}
