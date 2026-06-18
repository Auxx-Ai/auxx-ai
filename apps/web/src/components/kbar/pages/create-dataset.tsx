// apps/web/src/components/kbar/pages/create-dataset.tsx
'use client'

import { DatasetForm } from '~/components/datasets/dataset-form'
import { useCommandPaletteStore } from '../store'

/**
 * Hosts the shell-free {@link DatasetForm} as a palette page. The breadcrumb
 * supplies the title (no header slot). On success the palette closes; cancel /
 * back returns to root.
 */
export function CreateDatasetPage() {
  const close = useCommandPaletteStore((s) => s.close)
  const goTo = useCommandPaletteStore((s) => s.goTo)

  return (
    <div className='p-4 max-sm:flex max-sm:min-h-0 max-sm:flex-1 max-sm:flex-col max-sm:overflow-y-auto'>
      <DatasetForm onClose={close} onCancel={() => goTo('root')} />
    </div>
  )
}
