// apps/web/src/components/kb/hooks/use-knowledge-base-mutations.ts
'use client'

import type { KBDraftSettings } from '@auxx/lib/kb/client'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api } from '~/trpc/react'
import { getKnowledgeBaseStoreState, type KnowledgeBase } from '../store/knowledge-base-store'

interface CreateKBInput {
  name: string
  slug: string
}

/** Live-only fields. Draftable presentation fields go through `updateDraftSettings`. */
export interface KBLiveUpdateInput {
  slug?: string
  customDomain?: string | null
  visibility?: 'PUBLIC' | 'INTERNAL'
  publishStatus?: 'DRAFT' | 'PUBLISHED' | 'UNLISTED'
}

interface UseKBMutationsResult {
  createKnowledgeBase: (input: CreateKBInput) => Promise<KnowledgeBase | undefined>
  updateKnowledgeBase: (id: string, data: KBLiveUpdateInput) => Promise<KnowledgeBase | undefined>
  updateDraftSettings: (id: string, patch: KBDraftSettings) => Promise<KnowledgeBase | undefined>
  publishPendingSettings: (id: string) => Promise<KnowledgeBase | undefined>
  discardSettingsDraft: (id: string) => Promise<KnowledgeBase | undefined>
  deleteKnowledgeBase: (id: string) => Promise<boolean>
  isCreating: boolean
  isUpdating: boolean
  isUpdatingDraft: boolean
  isPublishingPending: boolean
  isDiscarding: boolean
  isDeleting: boolean
}

export function useKnowledgeBaseMutations(): UseKBMutationsResult {
  const utils = api.useUtils()
  const createMutation = api.kb.create.useMutation()
  const updateMutation = api.kb.update.useMutation()
  const updateDraftMutation = api.kb.updateDraftSettings.useMutation()
  const publishPendingMutation = api.kb.publishPendingSettings.useMutation()
  const discardDraftMutation = api.kb.discardSettingsDraft.useMutation()
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
      store.setKBOptimistic(id, data as Partial<KnowledgeBase>)
      try {
        const server = (await updateMutation.mutateAsync({ id, data })) as KnowledgeBase
        store.confirmKBUpdate(id, server)
        utils.kb.list.invalidate()
        utils.kb.byId.invalidate({ id })
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

  const updateDraftSettings = useCallback<UseKBMutationsResult['updateDraftSettings']>(
    async (id, patch) => {
      const store = getKnowledgeBaseStoreState()
      if (Object.keys(patch).length === 0) return undefined
      store.setKBDraftPatchOptimistic(id, patch)
      try {
        const server = (await updateDraftMutation.mutateAsync({
          id,
          patch,
        })) as KnowledgeBase
        store.confirmKBDraftFromServer(server)
        utils.kb.byId.invalidate({ id })
        return server
      } catch (error) {
        store.clearKBDraftOptimistic(id)
        toastError({
          title: 'Failed to save draft change',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        return undefined
      }
    },
    [updateDraftMutation, utils.kb.byId]
  )

  const publishPendingSettings = useCallback<UseKBMutationsResult['publishPendingSettings']>(
    async (id) => {
      const store = getKnowledgeBaseStoreState()
      store.clearKBDraftOptimistic(id)
      try {
        const server = (await publishPendingMutation.mutateAsync({ id })) as KnowledgeBase
        store.applyKnowledgeBaseFromServer(server)
        utils.kb.byId.invalidate({ id })
        utils.kb.list.invalidate()
        toastSuccess({ title: 'Pending settings published' })
        return server
      } catch (error) {
        toastError({
          title: 'Failed to publish pending settings',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        return undefined
      }
    },
    [publishPendingMutation, utils.kb.byId, utils.kb.list]
  )

  const discardSettingsDraft = useCallback<UseKBMutationsResult['discardSettingsDraft']>(
    async (id) => {
      const store = getKnowledgeBaseStoreState()
      store.clearKBDraftOptimistic(id)
      try {
        const server = (await discardDraftMutation.mutateAsync({ id })) as KnowledgeBase
        store.applyKnowledgeBaseFromServer(server)
        utils.kb.byId.invalidate({ id })
        return server
      } catch (error) {
        toastError({
          title: 'Failed to discard draft',
          description: error instanceof Error ? error.message : 'Unknown error occurred',
        })
        return undefined
      }
    },
    [discardDraftMutation, utils.kb.byId]
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
    updateDraftSettings,
    publishPendingSettings,
    discardSettingsDraft,
    deleteKnowledgeBase,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isUpdatingDraft: updateDraftMutation.isPending,
    isPublishingPending: publishPendingMutation.isPending,
    isDiscarding: discardDraftMutation.isPending,
    isDeleting: deleteMutation.isPending,
  }
}
