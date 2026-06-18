// apps/web/src/components/kbar/pages/create-inbox.tsx
'use client'

import { InboxForm } from '~/components/inbox/inbox-form'
import { useCommandPaletteStore } from '../store'

/**
 * Hosts the shell-free {@link InboxForm} as a palette page (create mode only).
 * The breadcrumb supplies the title (no header slot). On success / cancel the
 * palette closes; back returns to root.
 */
export function CreateInboxPage() {
  const page = useCommandPaletteStore((s) => s.page)
  const close = useCommandPaletteStore((s) => s.close)
  const goTo = useCommandPaletteStore((s) => s.goTo)

  return (
    <div className='p-4 max-sm:flex max-sm:min-h-0 max-sm:flex-1 max-sm:flex-col max-sm:overflow-y-auto'>
      <InboxForm
        open={page === 'create-inbox'}
        onSuccess={close}
        onClose={close}
        onCancel={() => goTo('root')}
      />
    </div>
  )
}
