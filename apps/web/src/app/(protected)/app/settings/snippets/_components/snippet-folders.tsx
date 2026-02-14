// apps/web/src/app/(protected)/app/settings/snippets/_components/snippet-folders.tsx
'use client'
import { Button } from '@auxx/ui/components/button'
import { InputSearch } from '@auxx/ui/components/input-search'
import { cn } from '@auxx/ui/lib/utils'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from 'lucide-react'
import { useQueryState } from 'nuqs'
import React, { useEffect } from 'react'
import { useSnippetContext } from '~/contexts/snippet-context'
import type { SnippetFolder } from '~/contexts/snippet-types'
import { useConfirm } from '~/hooks/use-confirm'
import { type FolderFormData, FolderFormPopover } from './folder-form-popover'

interface SnippetFoldersProps {
  selectedFolderId?: string | null
  onSelectFolder: (folderId: string | null) => void
}

export function SnippetFolders({ selectedFolderId, onSelectFolder }: SnippetFoldersProps) {
  const [searchTerm, setSearchTerm] = React.useState('')

  // Use the snippet context instead of direct tRPC calls
  const { folders, createFolder, updateFolder, deleteFolder, isCreatingFolder, isUpdatingFolder } =
    useSnippetContext()

  // Use nuqs to persist expanded folders in URL
  const [expandedFoldersStr, setExpandedFoldersStr] = useQueryState('expanded', {
    defaultValue: '',
  })

  // Parse expanded folders from URL parameter
  const expandedFolders = React.useMemo(() => {
    if (!expandedFoldersStr) return new Set<string>()
    try {
      return new Set(expandedFoldersStr.split(','))
    } catch (e) {
      return new Set<string>()
    }
  }, [expandedFoldersStr])

  // Use confirm hook for delete confirmation
  const [confirmDelete, ConfirmDeleteDialog] = useConfirm()

  // Filter folders based on search
  const rootFolders = React.useMemo(() => {
    if (!folders) return []

    if (!searchTerm) {
      return folders.filter((folder) => !folder.parentId)
    }

    // If searching, flatten the folder structure and filter by name
    const allFolders: SnippetFolder[] = []

    function flattenFolders(folderList: SnippetFolder[]) {
      folderList.forEach((folder) => {
        allFolders.push(folder)
        if (folder.subfolders && folder.subfolders.length > 0) {
          flattenFolders(folder.subfolders)
        }
      })
    }

    flattenFolders(folders)

    return allFolders.filter((folder) =>
      folder.name.toLowerCase().includes(searchTerm.toLowerCase())
    )
  }, [folders, searchTerm])

  // Toggle folder expansion
  const toggleFolderExpansion = (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation()

    // Create a new Set with the current expanded folders
    const newExpandedFolders = new Set(expandedFolders)

    if (newExpandedFolders.has(folderId)) {
      newExpandedFolders.delete(folderId)
    } else {
      newExpandedFolders.add(folderId)
    }

    // Convert Set to string for URL storage
    setExpandedFoldersStr(Array.from(newExpandedFolders).join(',') || null)
  }

  // Auto-expand parent folders when a subfolder is selected
  useEffect(() => {
    if (selectedFolderId && folders) {
      const folder = folders.find((f) => f.id === selectedFolderId)

      if (folder?.parentId) {
        const newExpandedFolders = new Set(expandedFolders)

        // Traverse up the folder hierarchy and expand all parent folders
        let currentParentId: string | null = folder.parentId
        while (currentParentId) {
          newExpandedFolders.add(currentParentId)

          // Find the parent folder
          const parentFolder = folders.find((f) => f.id === currentParentId)
          currentParentId = parentFolder?.parentId || null
        }

        // Update expanded folders if we added any
        if (newExpandedFolders.size !== expandedFolders.size) {
          setExpandedFoldersStr(Array.from(newExpandedFolders).join(','))
        }
      }
    }
  }, [selectedFolderId, folders, expandedFolders, setExpandedFoldersStr])

  /** Handles folder creation */
  const handleCreateFolder = async (data: FolderFormData) => {
    await createFolder({
      name: data.name,
      description: data.description || undefined,
      parentId: data.parentId || undefined,
    })
  }

  /** Handles folder update */
  const handleUpdateFolder = async (folderId: string, data: FolderFormData) => {
    await updateFolder(folderId, {
      name: data.name,
      description: data.description || undefined,
      parentId: data.parentId,
    })
  }

  // Handle folder delete
  const handleDeleteFolder = async (folder: SnippetFolder) => {
    const warningMessage =
      folder._count && folder._count.snippets > 0
        ? `This folder contains ${folder._count.snippets} snippet(s). They will be moved to the root level.`
        : undefined

    const confirmed = await confirmDelete({
      title: 'Delete Folder',
      description: `Are you sure you want to delete this folder?${warningMessage ? ` ${warningMessage}` : ''}`,
      confirmText: 'Delete Folder',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (!confirmed) return

    try {
      await deleteFolder(folder.id)

      // If the deleted folder was selected, reset selection
      if (selectedFolderId === folder.id) {
        onSelectFolder(null)
      }
    } catch (error) {
      // Error is already handled by the context
    }
  }

  // Open delete dialog
  const openDeleteDialog = (folder: SnippetFolder, e: React.MouseEvent) => {
    e.stopPropagation()
    handleDeleteFolder(folder)
  }

  // Recursive component for folder tree
  const renderFolderTree = (folders: SnippetFolder[], level = 0) => {
    return folders.map((folder) => {
      const hasSubfolders = folder.subfolders && folder.subfolders.length > 0
      const isExpanded = expandedFolders.has(folder.id)

      return (
        <div key={folder.id} className='flex flex-col space-y-0.5'>
          <div
            data-active={selectedFolderId === folder.id}
            className={cn(
              'group flex h-7 w-full items-center cursor-default gap-2 overflow-hidden rounded-md p-2 pe-0.5 text-left text-sm outline-hidden ring-sidebar-ring text-neutral-500',
              'transition-[width,height,padding] hover:bg-black/5 dark:hover:bg-primary-100 hover:text-foreground focus-visible:ring-2',
              'active:bg-black/5 dark:active:bg-primary-200 active:text-foreground disabled:pointer-events-none disabled:opacity-50',
              'data-[active=true]:bg-black/5 dark:data-[active=true]:bg-primary-200 dark:data-[active=true]:hover:bg-primary-300/60 data-[active=true]:text-foreground',
              '[&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 shrink-0',
              'ml-' + level * 10
            )}
            // className={cn(
            //   'group flex cursor-pointer items-center rounded-md px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800',
            //   selectedFolderId === folder.id ? 'bg-gray-100 dark:bg-gray-800' : ''
            // )}
            onClick={() => onSelectFolder(folder.id)}>
            <div className='flex flex-1 items-center overflow-hidden'>
              {hasSubfolders ? (
                <button
                  onClick={(e) => toggleFolderExpansion(folder.id, e)}
                  className='mr-1 focus:outline-hidden shrink-0'>
                  {isExpanded ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
                </button>
              ) : (
                <span className='mr-1 w-2'></span>
              )}
              <FolderIcon size={16} className='mr-2 shrink-0' />
              <span className='truncate cursor-default'>{folder.name}</span>
              <span className='ml-2 text-xs text-gray-500'>{folder._count?.snippets || 0}</span>
            </div>

            <div className='flex items-center'>
              <FolderFormPopover
                folder={folder}
                allFolders={folders}
                onSubmit={(data) => handleUpdateFolder(folder.id, data)}
                isLoading={isUpdatingFolder}
                trigger={
                  <Button
                    variant='ghost'
                    size='icon-xs'
                    className='bg-transparent size-5 opacity-0 transition-opacity group-hover:opacity-100'
                    onClick={(e) => e.stopPropagation()}
                    title='Edit folder'>
                    <PencilIcon className='size-3!' />
                  </Button>
                }
              />
              <Button
                variant='destructive-hover'
                size='icon'
                className='bg-transparent size-5 opacity-0 transition-opacity group-hover:opacity-100'
                onClick={(e) => openDeleteDialog(folder, e)}
                title='Delete folder'>
                <TrashIcon className='size-3!' />
              </Button>
            </div>
          </div>

          {hasSubfolders && isExpanded && folder.subfolders && (
            <div className='mt-1'>{renderFolderTree(folder.subfolders, level + 1)}</div>
          )}
        </div>
      )
    })
  }

  return (
    <div className='flex h-full flex-col border-r'>
      <div className='border-b p-3'>
        <div className='mb-2 flex items-center justify-between'>
          <h3 className='font-medium'>Folders</h3>

          {/* Create Folder Popover */}
          <FolderFormPopover
            allFolders={folders}
            onSubmit={handleCreateFolder}
            isLoading={isCreatingFolder}
            trigger={
              <Button variant='ghost' size='icon-xs' className='rounded-md'>
                <PlusIcon />
              </Button>
            }
          />
        </div>
        <InputSearch
          placeholder='Search folders...'
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className='flex-1 overflow-auto p-2 space-y-0.5 cursor-default'>
        <div
          data-active={!selectedFolderId}
          className={cn(
            'group flex h-7 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring text-neutral-500',
            'transition-[width,height,padding] hover:bg-black/5 dark:hover:bg-primary-100 hover:text-foreground focus-visible:ring-2',
            'active:bg-black/5 dark:active:bg-primary-200 active:text-foreground disabled:pointer-events-none disabled:opacity-50',
            'data-[active=true]:bg-black/5 dark:data-[active=true]:bg-primary-200 dark:data-[active=true]:hover:bg-primary-300/60 data-[active=true]:text-foreground',
            '[&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0'
            // !selectedFolderId ? 'bg-gray-100 dark:bg-gray-800' : ''
          )}
          onClick={() => onSelectFolder(null)}>
          <FolderIcon size={16} className='mr-2 shrink-0' />
          <span className=''>All Snippets</span>
        </div>

        {rootFolders.length > 0 ? renderFolderTree(rootFolders) : null}
      </div>

      {/* Delete Folder Confirmation Dialog */}
      <ConfirmDeleteDialog />
    </div>
  )
}
