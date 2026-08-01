// apps/web/src/components/global-create/global-create-root.tsx

'use client'

import { useHotkeySequence } from '@tanstack/react-hotkeys'
import { RecordEditorDialog } from '~/components/records/record-editor-dialog'
import { useResources } from '~/components/resources/hooks/use-resources'
import { useRecordStore } from '~/components/resources/store/record-store'
import { api } from '~/trpc/react'
import { useCreateEntityStore } from './create-entity-store'
import { SYSTEM_CREATE_HOTKEYS } from './system-hotkeys'

const HOTKEY_TIMEOUT = 500

/**
 * Root-level renderer for the global "create any entity" dialog.
 * Mount once at the app layout level so entities can be created from anywhere.
 *
 * Handles four fixed system-entity shortcuts (contacts, tickets, parts, companies)
 * and hosts a single RecordEditorDialog driven by useCreateEntityStore, which
 * resolves the right editor per entity type (e.g. the custom Parts dialog).
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

  useHotkeySequence(SYSTEM_CREATE_HOTKEYS.contacts, () => openForSlug('contacts'), {
    timeout: HOTKEY_TIMEOUT,
  })
  useHotkeySequence(SYSTEM_CREATE_HOTKEYS.companies, () => openForSlug('companies'), {
    timeout: HOTKEY_TIMEOUT,
  })
  useHotkeySequence(SYSTEM_CREATE_HOTKEYS.tickets, () => openForSlug('tickets'), {
    timeout: HOTKEY_TIMEOUT,
  })
  useHotkeySequence(SYSTEM_CREATE_HOTKEYS.parts, () => openForSlug('parts'), {
    timeout: HOTKEY_TIMEOUT,
  })

  if (!open || !entityDefinitionId) return null

  return (
    <RecordEditorDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) closeDialog()
      }}
      entityDefinitionId={entityDefinitionId}
      onSaved={() => {
        // The create hook already seeded the new row's DATA (record + field-value
        // stores), so any recordId-keyed view renders it instantly. But this is a
        // global surface with no listKey, and a mounted table may be filtered/
        // sorted for a different def — a blind seed-append can't place the row
        // correctly there. Re-query the server lists so filter/sort/pagination
        // stay correct.
        useRecordStore.getState().invalidateLists(entityDefinitionId)
        utils.record.listFiltered.invalidate()
      }}
    />
  )
}
