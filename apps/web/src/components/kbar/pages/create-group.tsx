// apps/web/src/components/kbar/pages/create-group.tsx
'use client'

import { GroupDetailDialog } from '~/components/groups'
import { useCommandPaletteStore } from '../store'

/**
 * Hosts the shell-free {@link GroupDetailDialog} (create mode) as a palette page.
 * `GroupDetailDialog` is already shell-free content (its `Dialog` is supplied by
 * the host), so the page renders it directly; the breadcrumb supplies the title.
 * On success the palette closes; cancel / back returns to root.
 */
export function CreateGroupPage() {
  const close = useCommandPaletteStore((s) => s.close)
  const goTo = useCommandPaletteStore((s) => s.goTo)

  return (
    <div className='p-4 max-sm:flex max-sm:min-h-0 max-sm:flex-1 max-sm:flex-col max-sm:overflow-y-auto'>
      <GroupDetailDialog mode='create' onSuccess={close} onCancel={() => goTo('root')} />
    </div>
  )
}
