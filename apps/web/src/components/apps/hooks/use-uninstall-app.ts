// apps/web/src/components/apps/hooks/use-uninstall-app.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'
import { api } from '~/trpc/react'

/**
 * Confirm-and-uninstall flow for an installed app, shared by the apps list pages.
 * Invalidates `apps.list` / `apps.listInstalled` and refreshes the ExtensionsContext
 * projection so every card grid updates without a reload. Render `<ConfirmDialog />`
 * once in the calling page.
 */
export function useUninstallApp() {
  const utils = api.useUtils()
  const { refreshInstallations } = useExtensionsContext()
  const [confirm, ConfirmDialog] = useConfirm()

  const uninstall = api.apps.uninstall.useMutation({
    onError: (error) => {
      toastError({ title: 'Failed to uninstall app', description: error.message })
    },
  })

  // `type` is the installation's installationType (a plain text column, so typed `string`);
  // values outside the dev/prod union fall back to "first active installation".
  const uninstallApp = async (appSlug: string, type?: string) => {
    const confirmed = await confirm({
      title: 'Uninstall app?',
      description: 'Workflows and agents using this app will stop working.',
      confirmText: 'Uninstall',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return

    try {
      await uninstall.mutateAsync({
        appSlug,
        type: type === 'development' || type === 'production' ? type : undefined,
      })
    } catch {
      return // toast shown by onError
    }
    await Promise.all([
      utils.apps.list.invalidate(),
      utils.apps.listInstalled.invalidate(),
      refreshInstallations(),
    ])
  }

  return { uninstallApp, isPending: uninstall.isPending, ConfirmDialog }
}
