// apps/web/src/components/kbar/pages/create-field.tsx
'use client'

import { CustomFieldForm } from '~/components/custom-fields/ui/custom-field-form'
import { useCommandPaletteStore } from '../store'

/**
 * Hosts {@link CustomFieldForm} as a palette page (no modal shell, no header
 * slot — the breadcrumb supplies the title). The unsaved-changes guard lives in
 * the shell; this page only reports dirty state up and routes close/cancel
 * through the shell's handlers. It also forwards `onWideChange` so the shell can
 * spring the palette width to `xxl` for RELATIONSHIP. The field-create mutation
 * already syncs the resource store + invalidates custom-field queries, so no
 * extra cache wiring is needed on save.
 */
export function CreateFieldPage({
  onDirtyChange,
  onRequestClose,
  onWideChange,
}: {
  onDirtyChange: (isDirty: boolean) => void
  onRequestClose: () => void
  onWideChange: (wide: boolean) => void
}) {
  const page = useCommandPaletteStore((s) => s.page)
  const entityDefinitionId = useCommandPaletteStore((s) => s.createFieldEntityId)
  const close = useCommandPaletteStore((s) => s.close)

  if (!entityDefinitionId) return null

  return (
    <div className='flex flex-col gap-4 p-4 max-sm:min-h-0 max-sm:flex-1 max-sm:overflow-y-auto'>
      <CustomFieldForm
        open={page === 'create-field'}
        entityDefinitionId={entityDefinitionId}
        onClose={close}
        onRequestClose={onRequestClose}
        onDirtyChange={onDirtyChange}
        onWideChange={onWideChange}
      />
    </div>
  )
}
