// apps/web/src/components/kbar/command-palette.tsx
'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { useEffect, useState } from 'react'
import { useResources } from '~/components/resources/hooks/use-resources'
import { preventTaskPickerEscape } from '~/components/tasks/ui/task-form'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import { CreatePage } from './pages/create'
import { CreateApiKeyPage } from './pages/create-api-key'
import { CreateDashboardPage } from './pages/create-dashboard'
import { CreateDatasetPage } from './pages/create-dataset'
import { CreateFieldPage } from './pages/create-field'
import { CreateGroupPage } from './pages/create-group'
import { CreateInboxPage } from './pages/create-inbox'
import { CreateMailViewPage } from './pages/create-mail-view'
import { CreateMeetingPage } from './pages/create-meeting'
import { CreateSignaturePage } from './pages/create-signature'
import { CreateSnippetPage } from './pages/create-snippet'
import { CreateTaskPage } from './pages/create-task'
import { CreateWebhookPage } from './pages/create-webhook'
import { RecordActionsPage } from './pages/record-actions'
import { RootPage } from './pages/root'
import { SearchPage } from './pages/search'
import { SearchThreadsPage } from './pages/search-threads'
import { useRecentsStore } from './recents-store'
import { useCommandPaletteStore } from './store'
import type { PalettePage } from './types'
import { usePaletteActions } from './use-palette-actions'
import { usePaletteHotkeys } from './use-palette-hotkeys'

/**
 * Simple create pages whose breadcrumb is just a single non-interactive crumb
 * (title === crumb label, back goes to root). The entity `create` page is not
 * here — it has a dynamic label and a dirty guard on its back button.
 */
const SIMPLE_CREATE_TITLES: Partial<Record<PalettePage, string>> = {
  'create-snippet': 'Create Snippet',
  'create-signature': 'Create Signature',
  'create-task': 'Create Task',
  'create-api-key': 'Create API Key',
  'create-webhook': 'Create Webhook',
  'create-inbox': 'Create Inbox',
  'create-mail-view': 'Create Mail View',
  'create-meeting': 'Create Meeting',
  'create-group': 'Create Group',
  'create-dataset': 'Create Dataset',
  'create-dashboard': 'Create Dashboard',
}

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
  const createFieldEntityId = useCommandPaletteStore((s) => s.createFieldEntityId)

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
  const createFieldLabel = createFieldEntityId
    ? getResourceById(createFieldEntityId)?.label
    : undefined

  // Form-page unsaved-changes guard. Only armed while a guarded create-form page
  // (record `create` or `create-field`) is shown — so Esc / outside-click on
  // other pages close normally.
  const isGuardedPage = page === 'create' || page === 'create-field'
  const [formDirty, setFormDirty] = useState(false)
  useEffect(() => {
    if (!isGuardedPage) setFormDirty(false)
  }, [isGuardedPage])

  // RELATIONSHIP wants a wider create-field page; the form signals it up so the
  // DialogNavPage size can spring (no remount → form state preserved).
  const [createFieldWide, setCreateFieldWide] = useState(false)
  useEffect(() => {
    if (page !== 'create-field') setCreateFieldWide(false)
  }, [page])

  const { guardProps, guardedClose, ConfirmDialog } = useUnsavedChangesGuard({
    isDirty: isGuardedPage && formDirty,
    onConfirmedClose: () => goTo('root'),
  })

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent
          size='content'
          position='tc'
          innerClassName='p-0'
          mobileFullHeight
          showClose={false}
          // The palette pages supply their own titles (DialogNav / sr-only) but
          // no description; opt out explicitly so Radix doesn't warn.
          aria-describedby={undefined}
          // Keep the @mention picker's Esc from closing the palette on the task page.
          onEscapeKeyDown={page === 'create-task' ? preventTaskPickerEscape : undefined}
          {...(isGuardedPage ? guardProps : {})}>
          {page === 'root' ? (
            // Root has its own cmdk search input, so it skips the breadcrumb bar —
            // this hidden title keeps Radix Dialog accessible.
            <DialogHeader className='sr-only'>
              <DialogTitle>Command palette</DialogTitle>
            </DialogHeader>
          ) : page === 'search' ? (
            <DialogNav title='Search records' crumbs={[{ label: 'Search' }]} onBack={back} />
          ) : page === 'search-threads' ? (
            <DialogNav
              title='Search threads'
              crumbs={[{ label: 'Search threads' }]}
              onBack={back}
            />
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
          ) : page === 'create-field' ? (
            <DialogNav
              title={`Create field${createFieldLabel ? ` on ${createFieldLabel}` : ''}`}
              crumbs={[{ label: 'Create field' }]}
              onBack={guardedClose}
            />
          ) : SIMPLE_CREATE_TITLES[page] ? (
            <DialogNav
              title={SIMPLE_CREATE_TITLES[page] as string}
              crumbs={[{ label: SIMPLE_CREATE_TITLES[page] as string }]}
              onBack={back}
            />
          ) : null}

          {/* Every palette page pads itself in full (`p-4` around body *and*
              footer), so the nested-footer gutter would stack on top of it and
              indent the buttons past the fields. The footer's own `pt-4` stays. */}
          <DialogNavPages
            value={page}
            footerGutter={false}
            className='max-sm:min-h-0 max-sm:flex-1'>
            <DialogNavPage value='root' size='md'>
              <RootPage sections={sections} recentActions={recentActions} />
            </DialogNavPage>
            <DialogNavPage value='search' size='xxl'>
              <SearchPage />
            </DialogNavPage>
            <DialogNavPage value='search-threads' size='3xl'>
              <SearchThreadsPage />
            </DialogNavPage>
            <DialogNavPage value='record-actions' size='sm'>
              <RecordActionsPage />
            </DialogNavPage>
            <DialogNavPage value='create' size='lg'>
              <CreatePage onDirtyChange={setFormDirty} onRequestClose={guardedClose} />
            </DialogNavPage>
            <DialogNavPage value='create-field' size={createFieldWide ? 'xxl' : 'md'}>
              <CreateFieldPage
                onDirtyChange={setFormDirty}
                onRequestClose={guardedClose}
                onWideChange={setCreateFieldWide}
              />
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
            <DialogNavPage value='create-api-key' size='md'>
              <CreateApiKeyPage />
            </DialogNavPage>
            <DialogNavPage value='create-webhook' size='lg'>
              <CreateWebhookPage />
            </DialogNavPage>
            <DialogNavPage value='create-inbox' size='lg'>
              <CreateInboxPage />
            </DialogNavPage>
            <DialogNavPage value='create-mail-view' size='xl'>
              <CreateMailViewPage />
            </DialogNavPage>
            <DialogNavPage value='create-meeting' size='lg'>
              <CreateMeetingPage />
            </DialogNavPage>
            <DialogNavPage value='create-group' size='md'>
              <CreateGroupPage />
            </DialogNavPage>
            <DialogNavPage value='create-dataset' size='md'>
              <CreateDatasetPage />
            </DialogNavPage>
            <DialogNavPage value='create-dashboard' size='md'>
              <CreateDashboardPage />
            </DialogNavPage>
          </DialogNavPages>
        </DialogContent>
      </Dialog>
      <ConfirmDialog />
    </>
  )
}
