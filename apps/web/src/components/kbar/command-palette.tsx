// apps/web/src/components/kbar/command-palette.tsx
'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { useEffect, useState } from 'react'
import { useResources } from '~/components/resources/hooks/use-resources'
import { preventTaskPickerEscape } from '~/components/tasks/ui/task-form'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { CreatePage } from './pages/create'
import { CreateSignaturePage } from './pages/create-signature'
import { CreateSnippetPage } from './pages/create-snippet'
import { CreateTaskPage } from './pages/create-task'
import { RecordActionsPage } from './pages/record-actions'
import { RootPage } from './pages/root'
import { SearchPage } from './pages/search'
import { useRecentsStore } from './recents-store'
import { useCommandPaletteStore } from './store'
import { usePaletteActions } from './use-palette-actions'
import { usePaletteHotkeys } from './use-palette-hotkeys'

/**
 * The command palette (cmd+k). Mounted once at the app root — replaces the old
 * `<KBar>`. A `Dialog` shell hosts a `DialogNav` breadcrumb (on sub-pages) plus
 * a size-animated `DialogNavPages` switcher. Global chords + `Meta+K` are bound
 * here via {@link usePaletteHotkeys}. The shell also owns the create page's
 * unsaved-changes guard (the `guardProps` must sit on `DialogContent`, and the
 * breadcrumb back button must be guarded).
 */
export function CommandPalette() {
  const open = useCommandPaletteStore((s) => s.open)
  const page = useCommandPaletteStore((s) => s.page)
  const close = useCommandPaletteStore((s) => s.close)
  const goTo = useCommandPaletteStore((s) => s.goTo)
  const back = useCommandPaletteStore((s) => s.back)
  const selectedRecord = useCommandPaletteStore((s) => s.selectedRecord)
  const createEntityId = useCommandPaletteStore((s) => s.createEntityId)

  const { sections, byId } = usePaletteActions()
  usePaletteHotkeys(byId)

  // Resolve recent action ids → live actions (skip any that no longer exist,
  // e.g. a flag turned off).
  const recentIds = useRecentsStore((s) => s.actionIds)
  const recentActions = recentIds
    .map((id) => byId.get(id))
    .filter((a): a is NonNullable<typeof a> => a !== undefined)

  const { getResourceById } = useResources()
  const createLabel = createEntityId ? getResourceById(createEntityId)?.label : undefined

  // Create-page unsaved-changes guard. Only armed while the create page is shown
  // — so Esc / outside-click on other pages close normally.
  const [createDirty, setCreateDirty] = useState(false)
  useEffect(() => {
    if (page !== 'create') setCreateDirty(false)
  }, [page])

  const { guardProps, guardedClose, ConfirmDialog } = useUnsavedChangesGuard({
    isDirty: page === 'create' && createDirty,
    onConfirmedClose: () => goTo('root'),
  })

  const isCreate = page === 'create'

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent
          size='content'
          position='tc'
          innerClassName='p-0'
          showClose={false}
          // The palette pages supply their own titles (DialogNav / sr-only) but
          // no description; opt out explicitly so Radix doesn't warn.
          aria-describedby={undefined}
          // Keep the @mention picker's Esc from closing the palette on the task page.
          onEscapeKeyDown={page === 'create-task' ? preventTaskPickerEscape : undefined}
          {...(isCreate ? guardProps : {})}>
          {page === 'root' ? (
            // Root has its own cmdk search input, so it skips the breadcrumb bar —
            // this hidden title keeps Radix Dialog accessible.
            <DialogHeader className='sr-only'>
              <DialogTitle>Command palette</DialogTitle>
            </DialogHeader>
          ) : page === 'search' ? (
            <DialogNav title='Search records' crumbs={[{ label: 'Search' }]} onBack={back} />
          ) : page === 'record-actions' ? (
            <DialogNav
              title='Record actions'
              crumbs={[
                { label: 'Search', onClick: () => goTo('search') },
                { label: selectedRecord?.displayName ?? 'Actions' },
              ]}
              onBack={back}
            />
          ) : page === 'create' ? (
            <DialogNav
              title={`Create ${createLabel ?? 'record'}`}
              crumbs={[{ label: `Create ${createLabel ?? 'record'}` }]}
              onBack={guardedClose}
            />
          ) : page === 'create-snippet' ? (
            <DialogNav
              title='Create Snippet'
              crumbs={[{ label: 'Create Snippet' }]}
              onBack={back}
            />
          ) : page === 'create-signature' ? (
            <DialogNav
              title='Create Signature'
              crumbs={[{ label: 'Create Signature' }]}
              onBack={back}
            />
          ) : page === 'create-task' ? (
            <DialogNav title='Create Task' crumbs={[{ label: 'Create Task' }]} onBack={back} />
          ) : null}

          <DialogNavPages value={page}>
            <DialogNavPage value='root' size='md'>
              <RootPage sections={sections} recentActions={recentActions} />
            </DialogNavPage>
            <DialogNavPage value='search' size='xxl'>
              <SearchPage />
            </DialogNavPage>
            <DialogNavPage value='record-actions' size='sm'>
              <RecordActionsPage />
            </DialogNavPage>
            <DialogNavPage value='create' size='lg'>
              <CreatePage onDirtyChange={setCreateDirty} onRequestClose={guardedClose} />
            </DialogNavPage>
            <DialogNavPage value='create-snippet' size='xxl'>
              <CreateSnippetPage />
            </DialogNavPage>
            <DialogNavPage value='create-signature' size='xxl'>
              <CreateSignaturePage />
            </DialogNavPage>
            <DialogNavPage value='create-task' size='xl'>
              <CreateTaskPage />
            </DialogNavPage>
          </DialogNavPages>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  )
}
