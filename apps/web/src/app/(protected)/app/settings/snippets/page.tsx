'use client'

import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@auxx/ui/components/resizable'
import { PlusIcon } from 'lucide-react'
import React, { useEffect, useRef } from 'react'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import SettingsPage from '~/components/global/settings-page'
import { SnippetProvider, useSnippetContext } from '~/contexts/snippet-context'
import { SnippetFolders } from './_components/snippet-folders'
import { SnippetForm } from './_components/snippet-form'
import { SnippetTable } from './_components/snippet-table'

/**
 * Content component that uses the snippet context
 */
function SnippetsPageContent() {
  const {
    selectedFolderId,
    searchTerm,
    createDialogOpen,
    editDialogOpen,
    editingSnippet,
    folderPanelState,
    setSearchTerm,
    setSelectedFolderId,
    openCreateDialog,
    openEditDialog,
    closeDialogs,
    copySnippet,
    onFolderPanelResize,
    onFolderPanelCollapse,
    onFolderPanelExpand,
    breadcrumbs,
  } = useSnippetContext()

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

  const handleSearchChange = (term: string) => {
    setSearchTerm(term)
  }

  // Handle edit snippet
  const handleEditSnippet = (snippet: any) => {
    openEditDialog(snippet)
  }

  // Handle copy snippet
  const handleCopySnippet = async (snippet: any) => {
    try {
      await copySnippet(snippet)
      // The context will handle the success toast
    } catch (error) {
      // The context will handle the error toast
    }
  }

  return (
    <SettingsPage
      title='Snippets'
      description='Manage all the fields you need for adding and updating contacts.'
      breadcrumbs={breadcrumbs}
      button={
        <Button variant='outline' size='sm' onClick={() => openCreateDialog()}>
          <PlusIcon />
          New Snippet
        </Button>
      }>
      <div className='flex h-full w-full overflow-hidden'>
        <ResizablePanelGroup direction='horizontal'>
          <ResizablePanel
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
          <ResizablePanel defaultSize={75} minSize={0}>
            <SnippetTable
              // folderId={selectedFolderId}
              onEdit={handleEditSnippet}
              onCopy={handleCopySnippet}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={(open) => !open && closeDialogs()}>
        <DialogContent className='max-h-[90vh] overflow-auto'>
          <DialogHeader className='mb-4'>
            <DialogTitle>{editingSnippet ? 'Copy Snippet' : 'Create Snippet'}</DialogTitle>
          </DialogHeader>
          <SnippetForm
            initialValues={{
              ...editingSnippet,
              folderId: editingSnippet?.folderId || selectedFolderId || undefined,
            }}
            onSuccess={closeDialogs}
            onCancel={closeDialogs}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => !open && closeDialogs()}>
        <DialogContent className='max-h-[90vh] overflow-auto'>
          <DialogHeader className='mb-4'>
            <DialogTitle>Edit Snippet</DialogTitle>
          </DialogHeader>
          {editingSnippet && (
            <SnippetForm
              snippetId={editingSnippet.id}
              initialValues={editingSnippet}
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
