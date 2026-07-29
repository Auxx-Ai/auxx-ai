'use client'

import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@auxx/ui/components/resizable'
import { PlusIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import SettingsPage from '~/components/global/settings-page'
import { SnippetProvider, useSnippetContext } from '~/components/snippets/hooks/snippet-context'
import { useSnippetDialogStore } from '~/components/snippets/hooks/snippet-dialog-store'
import type { Snippet } from '~/components/snippets/hooks/snippet-types'
import { useSnippetAccess } from '~/components/snippets/hooks/use-snippet-access'
import { SnippetFolders } from '~/components/snippets/ui/snippet-folders'
import { SnippetForm } from '~/components/snippets/ui/snippet-form'
import { SnippetTable } from '~/components/snippets/ui/snippet-table'

/**
 * Content component that uses the snippet context
 */
function SnippetsPageContent() {
  const {
    selectedFolderId,
    editDialogOpen,
    editingSnippet,
    folderPanelState,
    setSelectedFolderId,
    openEditDialog,
    closeDialogs,
    copySnippet,
    onFolderPanelResize,
    onFolderPanelCollapse,
    onFolderPanelExpand,
    breadcrumbs,
  } = useSnippetContext()

  // Create runs through the global dialog so it's reachable from the command
  // palette too; edit/copy stay page-local.
  const openCreateSnippet = useSnippetDialogStore((s) => s.openCreate)

  // `snippet.create` asserts the coarse `snippets.manage` rung — there is no
  // instance to key on yet, so the New Snippet button is the only thing that
  // can hide it before the 403.
  const { canManage } = useSnippetAccess()
  // Per-instance rung for whatever is open in the edit dialog — drives the
  // dialog's own title; `SnippetForm` gates its inputs off the same hook.
  const { canEdit: canEditSelected } = useSnippetAccess(editingSnippet?.id)

  // Ref to control the resizable panel
  const folderPanelRef = useRef<ImperativePanelHandle>(null)

  // Effect to handle panel state changes
  useEffect(() => {
    if (folderPanelRef.current) {
      if (folderPanelState.isCollapsed) {
        folderPanelRef.current.collapse()
      } else {
        folderPanelRef.current.expand()
      }
    }
  }, [folderPanelState.isCollapsed])

  // Handle folder selection
  const handleFolderSelect = (newFolderId: string | null) => {
    setSelectedFolderId(newFolderId)
  }

  // Handle edit snippet
  const handleEditSnippet = (snippet: Snippet) => {
    openEditDialog(snippet)
  }

  // Handle copy snippet
  const handleCopySnippet = async (snippet: Snippet) => {
    try {
      await copySnippet(snippet)
      // The context will handle the success toast
    } catch (_error) {
      // The context will handle the error toast
    }
  }

  return (
    <SettingsPage
      title='Snippets'
      description='Manage all the fields you need for adding and updating contacts.'
      breadcrumbs={breadcrumbs}
      button={
        canManage ? (
          <Button variant='outline' size='sm' onClick={() => openCreateSnippet(selectedFolderId)}>
            <PlusIcon />
            New Snippet
          </Button>
        ) : undefined
      }>
      <div className='flex flex-1 min-h-0 w-full overflow-hidden flex-col'>
        <ResizablePanelGroup
          id='snippets-layout'
          direction='horizontal'
          className='flex flex-col flex-1 min-h-0'>
          <ResizablePanel
            id='snippets-folders'
            ref={folderPanelRef}
            defaultSize={folderPanelState.isCollapsed ? 0 : folderPanelState.defaultSize}
            minSize={folderPanelState.minSize}
            collapsible
            onCollapse={onFolderPanelCollapse}
            onExpand={onFolderPanelExpand}
            onResize={onFolderPanelResize}>
            <SnippetFolders
              selectedFolderId={selectedFolderId}
              onSelectFolder={handleFolderSelect}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel id='snippets-table' defaultSize={75} minSize={0}>
            <SnippetTable
              // folderId={selectedFolderId}
              onEdit={handleEditSnippet}
              onCopy={handleCopySnippet}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Edit dialog — read-only for a member holding `view` but not `edit`. */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => !open && closeDialogs()}>
        <DialogContent position='tc' size='xxl' innerClassName='max-h-[90vh] overflow-auto'>
          <DialogHeader className='mb-4'>
            <DialogTitle>{canEditSelected ? 'Edit Snippet' : 'Snippet'}</DialogTitle>
          </DialogHeader>
          {editingSnippet && (
            <SnippetForm
              snippetId={editingSnippet.id}
              initialValues={{
                title: editingSnippet.title,
                content: editingSnippet.content,
                contentHtml: editingSnippet.contentHtml ?? undefined,
                description: editingSnippet.description ?? undefined,
                folderId: editingSnippet.folderId,
              }}
              onSuccess={closeDialogs}
              onCancel={closeDialogs}
            />
          )}
        </DialogContent>
      </Dialog>
    </SettingsPage>
  )
}

export default function SnippetsPage() {
  return (
    <SnippetProvider>
      <SnippetsPageContent />
    </SnippetProvider>
  )
}
