// apps/web/src/components/global-create/global-create-root.tsx

'use client'

import { useHotkeySequence } from '@tanstack/react-hotkeys'
import { EntityInstanceDialog } from '~/components/custom-fields/ui/entity-instance-dialog'
import { useResources } from '~/components/resources/hooks/use-resources'
import { useCreateEntityStore } from './create-entity-store'

const HOTKEY_TIMEOUT = 500

/**
 * Root-level renderer for the global "create any entity" dialog.
 * Mount once at the app layout level so entities can be created from anywhere.
 *
 * Handles four fixed system-entity shortcuts (contacts, tickets, parts, companies)
 * and hosts a single EntityInstanceDialog driven by useCreateEntityStore.
 */
export function GlobalCreateRoot() {
  const open = useCreateEntityStore((s) => s.open)
  const entityDefinitionId = useCreateEntityStore((s) => s.entityDefinitionId)
  const closeDialog = useCreateEntityStore((s) => s.closeDialog)
  const { getResourceById } = useResources()

  const openForSlug = (apiSlug: string) => {
    const resource = getResourceById(apiSlug)
    if (!resource) return
    useCreateEntityStore.getState().openDialog({ entityDefinitionId: resource.id })
  }

  useHotkeySequence(['C', 'C'], () => openForSlug('contacts'), { timeout: HOTKEY_TIMEOUT })
  useHotkeySequence(['T', 'C'], () => openForSlug('tickets'), { timeout: HOTKEY_TIMEOUT })
  useHotkeySequence(['P', 'C'], () => openForSlug('parts'), { timeout: HOTKEY_TIMEOUT })
  useHotkeySequence(['C', 'O'], () => openForSlug('companies'), { timeout: HOTKEY_TIMEOUT })

  if (!open || !entityDefinitionId) return null

  return (
    <EntityInstanceDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) closeDialog()
      }}
      entityDefinitionId={entityDefinitionId}
    />
  )
}
