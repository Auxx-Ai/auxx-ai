// apps/web/src/components/dashboard/hooks/use-dashboard-mutations.ts
'use client'

// Consolidated dashboard row/version mutations — create, update, duplicate,
// delete (soft-archive), restore version, rename version. Each wraps the tRPC
// mutation with the shared error toast and the right cache invalidation, and
// returns a plain value/boolean so callers own only their confirms + navigation.
// Auto-save + Publish/Discard have their own draft-store-wired hooks
// (`use-dashboard-autosave`, `use-dashboard-publish`); this hook covers the rest.

import type { DashboardVisibility, DashboardWithLayout } from '@auxx/lib/dashboards/client'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import { api } from '~/trpc/react'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Unknown error')

interface CreateDashboardInput {
  name: string
  description?: string | null
  icon?: { iconId: string; color: string }
  visibility?: DashboardVisibility
}

interface UpdateDashboardPatch {
  name?: string
  description?: string | null
  icon?: { iconId: string; color: string } | null
  visibility?: DashboardVisibility
  position?: number
}

interface UseDashboardMutationsResult {
  createDashboard: (input: CreateDashboardInput) => Promise<DashboardWithLayout | undefined>
  updateDashboard: (id: string, patch: UpdateDashboardPatch) => Promise<boolean>
  /** Returns the new dashboard so callers can navigate to it. */
  duplicateDashboard: (id: string) => Promise<DashboardWithLayout | undefined>
  /** Soft-archive (`dashboard.delete` → `archivedAt`). Callers own the confirm. */
  deleteDashboard: (id: string) => Promise<boolean>
  /** Restore-as-draft: returns the updated dashboard so the caller can adopt the draft. */
  restoreVersion: (id: string, versionNumber: number) => Promise<DashboardWithLayout | undefined>
  /** Hard-delete a published version (the live version is server-guarded). Callers own the confirm. */
  deleteVersion: (id: string, versionNumber: number) => Promise<boolean>
  renameVersion: (id: string, versionNumber: number, label: string | null) => Promise<void>
  isCreating: boolean
  isUpdating: boolean
  isDuplicating: boolean
  isDeleting: boolean
  isRestoring: boolean
}

export function useDashboardMutations(): UseDashboardMutationsResult {
  const utils = api.useUtils()
  const createMutation = api.dashboard.create.useMutation()
  const updateMutation = api.dashboard.update.useMutation()
  const duplicateMutation = api.dashboard.duplicate.useMutation()
  const deleteMutation = api.dashboard.delete.useMutation()
  const restoreMutation = api.dashboard.restoreVersion.useMutation()
  const deleteVersionMutation = api.dashboard.deleteVersion.useMutation()
  const renameMutation = api.dashboard.renameVersion.useMutation()

  const invalidateList = useCallback(
    () => utils.dashboard.list.invalidate(),
    [utils.dashboard.list]
  )

  // Row edits that can also change the active version (update/restore) refresh
  // the list, the detail (`get`), and the version history.
  const invalidateDashboard = useCallback(
    (id: string) =>
      Promise.all([
        utils.dashboard.list.invalidate(),
        utils.dashboard.get.invalidate({ id }),
        utils.dashboard.listVersions.invalidate({ id }),
      ]),
    [utils.dashboard.list, utils.dashboard.get, utils.dashboard.listVersions]
  )

  // Depend on the STABLE `.mutateAsync` (React Query keeps its identity across
  // renders), not the mutation object (a fresh reference every render). Keeps
  // these callbacks referentially stable so consumers can safely put them in
  // effect/useCallback deps without re-render churn — same reason
  // `useAgentMutations.updateAgent` depends on `updateMutation.mutateAsync`.
  const createDashboard = useCallback<UseDashboardMutationsResult['createDashboard']>(
    async (input) => {
      try {
        const created = await createMutation.mutateAsync(input)
        await invalidateList()
        return created
      } catch (error) {
        toastError({ title: 'Failed to create dashboard', description: errMsg(error) })
        return undefined
      }
    },
    [createMutation.mutateAsync, invalidateList]
  )

  const updateDashboard = useCallback<UseDashboardMutationsResult['updateDashboard']>(
    async (id, patch) => {
      try {
        await updateMutation.mutateAsync({ id, ...patch })
        await invalidateDashboard(id)
        return true
      } catch (error) {
        toastError({ title: 'Failed to update dashboard', description: errMsg(error) })
        return false
      }
    },
    [updateMutation.mutateAsync, invalidateDashboard]
  )

  const duplicateDashboard = useCallback<UseDashboardMutationsResult['duplicateDashboard']>(
    async (id) => {
      try {
        const created = await duplicateMutation.mutateAsync({ id })
        await invalidateList()
        return created
      } catch (error) {
        toastError({ title: 'Failed to duplicate dashboard', description: errMsg(error) })
        return undefined
      }
    },
    [duplicateMutation.mutateAsync, invalidateList]
  )

  const deleteDashboard = useCallback<UseDashboardMutationsResult['deleteDashboard']>(
    async (id) => {
      try {
        await deleteMutation.mutateAsync({ id })
        await invalidateList()
        return true
      } catch (error) {
        toastError({ title: 'Failed to remove dashboard', description: errMsg(error) })
        return false
      }
    },
    [deleteMutation.mutateAsync, invalidateList]
  )

  const restoreVersion = useCallback<UseDashboardMutationsResult['restoreVersion']>(
    async (id, versionNumber) => {
      try {
        const { dashboard } = await restoreMutation.mutateAsync({ id, versionNumber })
        await invalidateDashboard(id)
        return dashboard
      } catch (error) {
        toastError({ title: 'Failed to restore version', description: errMsg(error) })
        return undefined
      }
    },
    [restoreMutation.mutateAsync, invalidateDashboard]
  )

  const deleteVersion = useCallback<UseDashboardMutationsResult['deleteVersion']>(
    async (id, versionNumber) => {
      try {
        await deleteVersionMutation.mutateAsync({ id, versionNumber })
        await utils.dashboard.listVersions.invalidate({ id })
        return true
      } catch (error) {
        toastError({ title: 'Failed to delete version', description: errMsg(error) })
        return false
      }
    },
    [deleteVersionMutation.mutateAsync, utils.dashboard.listVersions]
  )

  const renameVersion = useCallback<UseDashboardMutationsResult['renameVersion']>(
    async (id, versionNumber, label) => {
      try {
        await renameMutation.mutateAsync({ id, versionNumber, label })
        await utils.dashboard.listVersions.invalidate({ id })
      } catch (error) {
        toastError({ title: 'Failed to rename version', description: errMsg(error) })
      }
    },
    [renameMutation.mutateAsync, utils.dashboard.listVersions]
  )

  return {
    createDashboard,
    updateDashboard,
    duplicateDashboard,
    deleteDashboard,
    restoreVersion,
    deleteVersion,
    renameVersion,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDuplicating: duplicateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isRestoring: restoreMutation.isPending,
  }
}
