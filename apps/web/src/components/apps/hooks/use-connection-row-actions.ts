// apps/web/src/components/apps/hooks/use-connection-row-actions.ts

'use client'

import { toastError } from '@auxx/ui/components/toast'
import type { ReactElement } from 'react'
import { useCallback } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

interface UseConnectionRowActions {
  /** Resolves true on success, false when the trimmed label is empty or the mutation fails. */
  rename: (connectionId: string, label: string) => Promise<boolean>
  disconnect: (connectionId: string, currentLabel: string | null) => Promise<void>
  ConfirmDialog: () => ReactElement
  isRenaming: boolean
  isDisconnecting: boolean
}

/**
 * Bundles the rename / disconnect mutations and confirm flow that used to be
 * duplicated across `AppConnections` and `AppConnectionStatus`.
 * See plans/kopilot/apps/app-settings-dialog-refactor.md §3.4.
 */
export function useConnectionRowActions(): UseConnectionRowActions {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()

  const deleteConnection = api.apps.deleteConnection.useMutation({
    onSuccess: () => {
      void utils.apps.listConnections.invalidate()
      void utils.apps.listInstalled.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to disconnect', description: error.message })
    },
  })

  const renameConnection = api.apps.renameConnection.useMutation({
    onSuccess: () => {
      void utils.apps.listConnections.invalidate()
    },
    onError: (error) => {
      toastError({ title: 'Failed to rename', description: error.message })
    },
  })

  const rename = useCallback(
    async (connectionId: string, label: string): Promise<boolean> => {
      const trimmed = label.trim()
      if (!trimmed) return false
      try {
        await renameConnection.mutateAsync({ connectionId, label: trimmed })
        return true
      } catch {
        return false
      }
    },
    [renameConnection]
  )

  const disconnect = useCallback(
    async (connectionId: string, currentLabel: string | null) => {
      const confirmed = await confirm({
        title: 'Disconnect?',
        description: `Are you sure you want to disconnect "${currentLabel || 'Connection'}"? This may affect workflows using this connection.`,
        confirmText: 'Disconnect',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed) {
        deleteConnection.mutate({ credentialId: connectionId })
      }
    },
    [confirm, deleteConnection]
  )

  return {
    rename,
    disconnect,
    ConfirmDialog,
    isRenaming: renameConnection.isPending,
    isDisconnecting: deleteConnection.isPending,
  }
}
