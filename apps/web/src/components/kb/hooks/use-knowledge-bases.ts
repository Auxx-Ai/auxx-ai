// apps/web/src/components/kb/hooks/use-knowledge-bases.ts
'use client'

import { useEffect } from 'react'
import { useShallow } from 'zustand/shallow'
import { api } from '~/trpc/react'
import {
  getKnowledgeBaseStoreState,
  type KnowledgeBase,
  selectEffectiveKnowledgeBases,
  useKnowledgeBaseStore,
} from '../store/knowledge-base-store'

interface UseKnowledgeBasesResult {
  knowledgeBases: KnowledgeBase[]
  isLoading: boolean
  hasLoadedOnce: boolean
}

/**
 * Returns the list of knowledge bases. Backed by tRPC + the store
 * so optimistic create/update/delete reflect immediately.
 */
export function useKnowledgeBases(): UseKnowledgeBasesResult {
  const { data, isLoading } = api.kb.list.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    const store = getKnowledgeBaseStoreState()
    store.setLoading(isLoading)
    if (data) store.setKnowledgeBases(data as KnowledgeBase[])
  }, [data, isLoading])

  const knowledgeBases = useKnowledgeBaseStore(useShallow(selectEffectiveKnowledgeBases))
  const hasLoadedOnce = useKnowledgeBaseStore((s) => s.hasLoadedOnce)

  return { knowledgeBases, isLoading, hasLoadedOnce }
}
