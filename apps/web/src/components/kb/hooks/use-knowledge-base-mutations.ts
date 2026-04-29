// apps/web/src/components/kb/hooks/use-knowledge-base-mutations.ts
'use client'

import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import { getKnowledgeBaseStoreState, type KnowledgeBase } from '../store/knowledge-base-store'

interface CreateKBInput {
  name: string
  slug: string
  isPublic?: boolean
}

interface UseKBMutationsResult {
  createKnowledgeBase: (input: CreateKBInput) => Promise<KnowledgeBase | undefined>
  updateKnowledgeBase: (
    id: string,
    data: Partial<KnowledgeBase>
  ) => Promise<KnowledgeBase | undefined>
  deleteKnowledgeBase: (id: string) => Promise<boolean>
  isCreating: boolean
  isUpdating: boolean
  isDeleting: boolean
}

export function useKnowledgeBaseMutations(): UseKBMutationsResult {
  const utils = api.useUtils()
  const createMutation = api.kb.create.useMutation()
  const updateMutation = api.kb.update.useMutation()
  const deleteMutation = api.kb.delete.useMutation()

  const createKnowledgeBase = useCallback<UseKBMutationsResult['createKnowledgeBase']>(
    async (input) => {
      try {
        const server = (await createMutation.mutateAsync(input)) as KnowledgeBase
        getKnowledgeBaseStoreState().applyKnowledgeBaseFromServer(server)
        utils.kb.list.invalidate()
        toastSuccess({
          title: 'Knowledge Base Created',
          description: `"${server.name}" has been created successfully.`,
        })
        return server
      } catch (error) {
        toastError({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        return undefined
      }
    },
    [createMutation, utils.kb.list]
  )

  const updateKnowledgeBase = useCallback<UseKBMutationsResult['updateKnowledgeBase']>(
    async (id, data) => {
      const store = getKnowledgeBaseStoreState()
      store.setKBOptimistic(id, data)
      try {
        const server = (await updateMutation.mutateAsync({
          id,
          data: data as any,
        })) as KnowledgeBase
        store.confirmKBUpdate(id, server)
        utils.kb.list.invalidate()
        utils.kb.byId.invalidate({ id })
        toastSuccess({ title: 'Knowledge base settings updated successfully' })
        return server
      } catch (error) {
        store.rollbackKBUpdate(id)
        toastError({
          title: 'Failed to update knowledge base',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        return undefined
      }
    },
    [updateMutation, utils.kb.list, utils.kb.byId]
  )

  const deleteKnowledgeBase = useCallback<UseKBMutationsResult['deleteKnowledgeBase']>(
    async (id) => {
      const store = getKnowledgeBaseStoreState()
      store.markKBDeleted(id)
      try {
        await deleteMutation.mutateAsync({ id })
        store.confirmKBDelete(id)
        utils.kb.list.invalidate()
        toastSuccess({ title: 'Knowledge base deleted' })
        return true
      } catch (error) {
        store.rollbackKBDelete(id)
        toastError({
          title: "Couldn't delete knowledge base",
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        return false
      }
    },
    [deleteMutation, utils.kb.list]
  )

  return {
    createKnowledgeBase,
    updateKnowledgeBase,
    deleteKnowledgeBase,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
