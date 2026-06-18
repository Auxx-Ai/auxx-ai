// apps/web/src/components/kbar/pages/create.tsx
'use client'

import { EntityInstanceForm } from '~/components/custom-fields/ui/entity-instance/entity-instance-form'
import { useRecordStore } from '~/components/resources/store/record-store'
import { api } from '~/trpc/react'
import { useCommandPaletteStore } from '../store'

/**
 * Hosts {@link EntityInstanceForm} as a palette page (no modal shell, no header
 * slot — the breadcrumb supplies the title). The unsaved-changes guard lives in
 * the shell (it owns the `DialogContent` + breadcrumb back); this page only
 * reports dirty state up and routes close/cancel through the shell's handlers.
 * On save it mirrors the cache invalidation `GlobalCreateRoot` does.
 */
export function CreatePage({
  onDirtyChange,
  onRequestClose,
}: {
  onDirtyChange: (isDirty: boolean) => void
  onRequestClose: () => void
}) {
  const page = useCommandPaletteStore((s) => s.page)
  const entityDefinitionId = useCommandPaletteStore((s) => s.createEntityId)
  const close = useCommandPaletteStore((s) => s.close)
  const utils = api.useUtils()

  if (!entityDefinitionId) return null

  return (
    <div className='flex flex-col gap-4 p-4 max-sm:min-h-0 max-sm:flex-1 max-sm:overflow-y-auto'>
      <EntityInstanceForm
        open={page === 'create'}
        entityDefinitionId={entityDefinitionId}
        onSaved={() => {
          // Mirror useRecordList.refresh() so any mounted records table picks up
          // the new row (the create mutation doesn't invalidate caches itself).
          useRecordStore.getState().invalidateLists(entityDefinitionId)
          utils.record.listFiltered.invalidate()
        }}
        onClose={close}
        onRequestClose={onRequestClose}
        onDirtyChange={onDirtyChange}
      />
    </div>
  )
}
