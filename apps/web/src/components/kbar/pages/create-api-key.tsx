// apps/web/src/components/kbar/pages/create-api-key.tsx
'use client'

import { ApiKeyForm } from '~/app/(protected)/app/settings/apiKeys/_components/api-key-form'
import { useCommandPaletteStore } from '../store'

/**
 * Hosts the shell-free {@link ApiKeyForm} as a palette page. The breadcrumb
 * supplies the title. Unlike the other create pages this does NOT close on
 * success — the form must stay mounted to reveal the one-time secret; its own
 * "Done" button calls `onClose` (which closes the palette). Cancel / back returns
 * to root.
 */
export function CreateApiKeyPage() {
  const page = useCommandPaletteStore((s) => s.page)
  const close = useCommandPaletteStore((s) => s.close)
  const goTo = useCommandPaletteStore((s) => s.goTo)

  return (
    <div className='p-4'>
      <ApiKeyForm open={page === 'create-api-key'} onClose={close} onCancel={() => goTo('root')} />
    </div>
  )
}
