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
      // Name what this actually destroys (plans/money/tasks/44 D-3, task 24 §6.3). The
      // dialog used to mention workflows and nothing else, while the mutation behind it
      // disconnected every connector on the credential AND cascaded every column scoped to
      // it. Fetched here rather than per row so a long connections list costs nothing.
      let impactClause = ''
      try {
        const { connectors, appFields } = await utils.apps.connectionImpact.fetch({
          credentialId: connectionId,
        })

        if (connectors.length > 0) {
          // ⚠️ Deliberately does NOT promise that reconnecting restores them. Reinstalling
          // an APP re-links its connectors automatically; re-adding a CONNECTION does
          // not — `deleteCredential` nulls `DataConnector.credentialId` via the FK and
          // nothing rebinds it, so recovery is re-picking the connection on the
          // connector itself. Saying "reconnecting restores them" here would be false.
          impactClause += ` ${connectors.length === 1 ? 'The connector' : `${connectors.length} connectors`} ${connectors.map((c) => `"${c.name}"`).join(', ')} ${connectors.length === 1 ? 'is' : 'are'} disconnected.`
        }

        // 🛑 This clause replaces "Synced records are kept; to resume, pick a connection
        // again on the connector.", which was false in the way that matters most:
        // `CustomField.connectionId` is `ON DELETE CASCADE` and the disconnect is a hard
        // delete, so the records ARE kept and their contents are deleted. On one dev org a
        // Shopify disconnect cascades 23 columns and 268,621 values — including the store
        // domain on 20,873 contacts and the order name on 13,523 orders, both visible. Same
        // defect `uninstall-app.ts`'s comment records fixing on the uninstall path.
        //
        // State exactly what the numbers count (columns and values, never records), per
        // `getUninstallImpact`'s docblock.
        if (appFields.total > 0) {
          const one = appFields.total === 1
          const columns = one ? 'the column' : `the ${appFields.total} columns`
          const visible =
            appFields.visible > 0
              ? one
                ? ' (visible on records)'
                : ` (${appFields.visible} of them visible on records)`
              : ''
          const values = `${appFields.valuesAffected.toLocaleString()} ${appFields.valuesAffected === 1 ? 'value' : 'values'}`
          impactClause += ` Disconnecting also deletes ${columns} this connection added${visible} and the ${values} stored in ${one ? 'it' : 'them'}. The records themselves stay; those cells go blank.`
        }
      } catch {
        // A failed impact read must not block the disconnect: the merchant gets the
        // generic warning rather than an error they cannot act on.
      }

      const confirmed = await confirm({
        title: 'Disconnect?',
        description: `Are you sure you want to disconnect "${currentLabel || 'Connection'}"? This may affect workflows using this connection.${impactClause}`,
        confirmText: 'Disconnect',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed) {
        deleteConnection.mutate({ credentialId: connectionId })
      }
    },
    [confirm, deleteConnection, utils]
  )

  return {
    rename,
    disconnect,
    ConfirmDialog,
    isRenaming: renameConnection.isPending,
    isDisconnecting: deleteConnection.isPending,
  }
}
