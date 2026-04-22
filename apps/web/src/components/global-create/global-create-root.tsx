// apps/web/src/components/global-create/global-create-root.tsx

'use client'

import { useHotkeySequence } from '@tanstack/react-hotkeys'
import { EntityInstanceDialog } from '~/components/custom-fields/ui/entity-instance-dialog'
import { useResources } from '~/components/resources/hooks/use-resources'
import { useRecordStore } from '~/components/resources/store/record-store'
import { api } from '~/trpc/react'
import { useCreateEntityStore } from './create-entity-store'
import { SYSTEM_CREATE_HOTKEYS } from './system-hotkeys'

const HOTKEY_TIMEOUT = 500
const upper = (combo: [string, string]): [string, string] => [
  combo[0].toUpperCase(),
  combo[1].toUpperCase(),
]

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
  const utils = api.useUtils()

  const openForSlug = (apiSlug: string) => {
    const resource = getResourceById(apiSlug)
    if (!resource) return
    useCreateEntityStore.getState().openDialog({ entityDefinitionId: resource.id })
  }

  useHotkeySequence(upper(SYSTEM_CREATE_HOTKEYS.contacts), () => openForSlug('contacts'), {
    timeout: HOTKEY_TIMEOUT,
  })
  useHotkeySequence(upper(SYSTEM_CREATE_HOTKEYS.companies), () => openForSlug('companies'), {
    timeout: HOTKEY_TIMEOUT,
  })
  useHotkeySequence(upper(SYSTEM_CREATE_HOTKEYS.tickets), () => openForSlug('tickets'), {
    timeout: HOTKEY_TIMEOUT,
  })
  useHotkeySequence(upper(SYSTEM_CREATE_HOTKEYS.parts), () => openForSlug('parts'), {
    timeout: HOTKEY_TIMEOUT,
  })

  if (!open || !entityDefinitionId) return null

  return (
    <EntityInstanceDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) closeDialog()
      }}
      entityDefinitionId={entityDefinitionId}
      onSaved={() => {
        // Mirror what useRecordList.refresh() does — otherwise any mounted
        // records table misses the new row (the create mutation itself
        // doesn't invalidate caches).
        useRecordStore.getState().invalidateLists(entityDefinitionId)
        utils.record.listFiltered.invalidate()
      }}
    />
  )
}
