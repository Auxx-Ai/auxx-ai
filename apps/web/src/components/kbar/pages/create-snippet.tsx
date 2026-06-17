// apps/web/src/components/kbar/pages/create-snippet.tsx
'use client'

import { SnippetForm } from '~/app/(protected)/app/settings/snippets/_components/snippet-form'
import { useCommandPaletteStore } from '../store'

/**
 * Hosts {@link SnippetForm} as a palette page. `SnippetForm` is already shell-free
 * (no `Dialog`, no header — it owns its own mutations + cache invalidation), so the
 * page just renders it; the breadcrumb supplies the title. On success the palette
 * closes; cancel / back returns to root.
 */
export function CreateSnippetPage() {
  const folderId = useCommandPaletteStore((s) => s.createSnippetFolderId)
  const close = useCommandPaletteStore((s) => s.close)
  const goTo = useCommandPaletteStore((s) => s.goTo)

  return (
    <div className='p-4'>
      <SnippetForm
        initialValues={{ folderId: folderId ?? undefined }}
        onSuccess={close}
        onCancel={() => goTo('root')}
      />
    </div>
  )
}
