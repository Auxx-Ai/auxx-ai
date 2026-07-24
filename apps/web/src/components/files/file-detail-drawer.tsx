// apps/web/src/components/files/file-detail-drawer.tsx

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Input } from '@auxx/ui/components/input'
import { MetricCell, MetricGrid } from '@auxx/ui/components/metric-grid'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { formatBytes, getStandardFileType } from '@auxx/utils/file'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Calendar,
  Database,
  Download,
  FileText,
  Folder,
  MoreHorizontal,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { Tooltip } from '~/components/global/tooltip'
import { CommandAction, CommandContext } from '~/components/kbar/contextual'
import { useCommandPaletteStore } from '~/components/kbar/store'
import { useConfirm } from '~/hooks/use-confirm'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useAccess } from '~/providers/capabilities-provider'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { AttachmentPreview } from '../attachments/attachment-preview'
import type { FileItem } from './files-store'
import { useFileSystemStore } from './files-store'
import { getFileIconId } from './utils/file-icon'

/**
 * Props for the FileDetailDrawer component
 */
interface FileDetailDrawerProps {
  file: FileItem
  onOpenChange: (open: boolean) => void
  setSelectedFile: (file: FileItem | null) => void
}

/**
 * Keyboard shortcut component
 */
const KeyboardShortcut = ({ shortcut }: { shortcut: string }) => (
  <span className='ml-auto pl-2 text-xs text-muted-foreground'>{shortcut}</span>
)

/**
 * Drawer component showing detailed file information.
 * Supports both overlay and docked modes.
 */
export function FileDetailDrawer({ file, onOpenChange, setSelectedFile }: FileDetailDrawerProps) {
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  // Layer-2 write gate — rename/delete require `files.manage` (Full).
  const { can } = useAccess()
  const canManageFiles = can(PermissionKey.filesManage)

  const [confirm, ConfirmDialog] = useConfirm()
  const [editingName, setEditingName] = useState(file.name || '')
  const [isRenaming, setIsRenaming] = useState(false)
  const [originalName, setOriginalName] = useState(file.name || '')

  /** Handle close */
  const handleClose = useCallback(() => {
    setSelectedFile(null)
  }, [setSelectedFile])

  // Store hooks for real-time updates
  const updateItem = useFileSystemStore((state) => state.updateItem)
  const removeItems = useFileSystemStore((state) => state.removeItems)
  const deleteFile = api.file.delete.useMutation()
  // Reset editing name when file changes
  useEffect(() => {
    setEditingName(file.name || '')
    setOriginalName(file.name || '')
  }, [file.name])

  // Rename mutation
  const renameItem = api.file.renameItem.useMutation({
    onSuccess: (updatedFile) => {
      // Update the store with the new file data
      updateItem(file.id, {
        name: updatedFile.name,
        updatedAt: updatedFile.updatedAt,
        path: updatedFile.path,
      })

      setIsRenaming(false)
    },
    onError: (error) => {
      // Revert optimistic update
      updateItem(file.id, { name: originalName })

      toastError({
        title: 'Failed to rename',
        description: error.message,
      })
      setEditingName(originalName) // Reset to original name
      setIsRenaming(false)
    },
  })

  // Query to get download reference
  const {
    data: downloadRef,
    isLoading: isDownloadLoading,
    refetch: refetchDownload,
  } = api.file.getAttachmentPreviewRef.useQuery(
    {
      type: 'file',
      id: file.id,
      version: 'current',
      disposition: 'attachment',
    },
    {
      enabled: false, // Only fetch when download is requested
      staleTime: 1 * 60 * 1000, // 1 minute
    }
  )

  const handleDownload = async () => {
    try {
      // If we don't have a download reference, fetch it
      if (!downloadRef) {
        const result = await refetchDownload()
        if (!result.data) {
          toastError({
            title: 'Download failed',
            description: 'Could not generate download link',
          })
          return
        }
      }

      const ref = downloadRef || (await refetchDownload()).data
      if (!ref) {
        toastError({
          title: 'Download failed',
          description: 'Could not generate download link',
        })
        return
      }

      if (ref.type === 'url') {
        // Create download link
        const link = document.createElement('a')
        link.href = ref.url
        link.download = ref.filename
        link.setAttribute('target', '_blank')
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      } else {
        toastError({
          title: 'Download failed',
          description: 'Stream-based downloads not supported',
        })
      }
    } catch (error) {
      toastError({
        title: 'Download failed',
        description: error instanceof Error ? error.message : 'An error occurred',
      })
    }
  }

  const handleRename = async () => {
    const trimmedName = editingName.trim()

    // Validation
    if (!trimmedName) {
      toastError({
        title: 'Invalid name',
        description: 'Name cannot be empty',
      })
      setEditingName(originalName) // Reset to original name
      return
    }

    if (trimmedName === originalName) {
      // No change, just exit rename mode
      setIsRenaming(false)
      return
    }

    // Store original name for potential rollback
    setOriginalName(file.name || '')

    // Optimistic update - immediately update the store
    updateItem(file.id, { name: trimmedName })

    setIsRenaming(true)
    renameItem.mutate({
      id: file.id,
      type: file.type,
      newName: trimmedName,
    })
  }

  const handleNameBlur = () => {
    handleRename()
  }

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEditingName(originalName) // Reset to original name
      // Revert any optimistic changes
      updateItem(file.id, { name: originalName })
      setIsRenaming(false)
    }
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete File',
      description: `Are you sure you want to delete "${file.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (!confirmed) return

    deleteFile.mutate(
      { fileId: file.id },
      {
        onSuccess: () => {
          removeItems([file.id]) // Drop from the store so the row disappears
          setSelectedFile(null)
          onOpenChange(false) // Close drawer after deletion
        },
        onError: (error) => {
          toastError({
            title: 'Failed to delete file',
            description: error.message,
          })
        },
      }
    )
  }

  // Close the palette before running an action so any resulting dialog/toast
  // isn't hidden behind the overlay.
  const closePalette = () => useCommandPaletteStore.getState().close()
  const copyLink = () => {
    if (file.url) void navigator.clipboard?.writeText(file.url)
    closePalette()
  }
  const copyId = () => {
    void navigator.clipboard?.writeText(file.id)
    closePalette()
  }

  if (!file) return null
  const titleError = false
  const { iconId, color } = getFileIconId(file.mimeType || undefined, file.ext || undefined)
  return (
    <>
      {/* Command-palette file scope — surfaces the open file's actions in cmd+k.
          Priority outranks the Files page scope so this group leads while the
          drawer is open. */}
      <CommandContext kind='page' label={file.name || 'File'} priority={10}>
        <CommandAction
          label='Download'
          icon='download'
          keywords='download save file'
          priority={10}
          disabled={file.isUploading || isDownloadLoading}
          perform={() => {
            closePalette()
            void handleDownload()
          }}
        />
        {file.url && (
          <CommandAction
            label='Copy link'
            icon='link-2'
            keywords='copy link url share'
            priority={6}
            perform={copyLink}
          />
        )}
        <CommandAction
          label='Copy ID'
          icon='copy'
          keywords='copy id identifier'
          priority={5}
          perform={copyId}
        />
        {canManageFiles && (
          <CommandAction
            label='Delete'
            icon='trash'
            keywords='delete remove'
            priority={1}
            disabled={file.isUploading}
            perform={() => {
              closePalette()
              void handleDelete()
            }}
          />
        )}
      </CommandContext>
      <DockableDrawer
        open={true}
        onOpenChange={onOpenChange}
        isDocked={isDocked}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
        minWidth={400}
        maxWidth={600}
        title={file.name || 'File'}>
        {/* Content */}
        <div className='flex-1 overflow-y-auto h-full flex flex-col rounded-t-xl'>
          <DrawerHeader
            icon={<EntityIcon iconId={iconId} color={color} className='size-6' />}
            title={
              <Input
                id='title'
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={handleNameBlur}
                onKeyDown={handleNameKeyDown}
                placeholder='Enter name'
                readOnly={!canManageFiles}
                disabled={isRenaming || renameItem.isPending}
                className={cn(
                  'mr-2 h-7 min-w-0 w-full appearance-none rounded-md border bg-transparent px-1 outline-none',
                  titleError ? 'border-red-500 ring-1 ring-red-500' : 'border-transparent',
                  'focus:shadow-xs',
                  (isRenaming || renameItem.isPending) && 'opacity-50 cursor-not-allowed'
                )}
              />
            }
            onClose={handleClose}
            actions={
              <>
                {file.isUploading && file.status && (
                  <Badge variant='secondary' className='text-xs capitalize mr-2'>
                    {file.status}
                  </Badge>
                )}
                <Tooltip content='Download'>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    className='rounded-full'
                    onClick={handleDownload}
                    disabled={file.isUploading || isDownloadLoading}>
                    <Download />
                  </Button>
                </Tooltip>

                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant='ghost' size='icon-sm' className='rounded-full'>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-48'>
                    <DropdownMenuItem
                      onClick={handleDownload}
                      disabled={file.isUploading || isDownloadLoading}>
                      <Download />
                      Download
                    </DropdownMenuItem>
                    {canManageFiles && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={handleDelete}
                          disabled={file.isUploading}
                          variant='destructive'>
                          <Trash2 />
                          Delete
                          <KeyboardShortcut shortcut='Del' />
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DockToggleButton />
              </>
            }
          />

          {/* Metrics */}
          <MetricGrid columns={2}>
            <MetricCell
              label='File Size'
              icon={<Database className='size-4 text-muted-foreground' />}
              value={formatBytes(file.displaySize)}
            />
            <MetricCell
              label='File Type'
              icon={<FileText className='size-4 text-muted-foreground' />}
              value={getStandardFileType(file.mimeType || undefined, file.ext || undefined)}
              description={file.mimeType || undefined}
            />
            <MetricCell
              label='Created'
              icon={<Calendar className='size-4 text-muted-foreground' />}
              value={formatDistanceToNow(new Date(file.createdAt), { addSuffix: true })}
              description={format(new Date(file.createdAt), 'MMM d, yyyy HH:mm')}
            />
            <MetricCell
              label='Modified'
              icon={<Calendar className='size-4 text-muted-foreground' />}
              value={formatDistanceToNow(new Date(file.updatedAt), { addSuffix: true })}
              description={format(new Date(file.updatedAt), 'MMM d, yyyy HH:mm')}
            />
          </MetricGrid>

          {/* Tabs */}
          <Tabs
            defaultValue='details'
            className='flex-1 flex flex-col h-full bg-secondary/20 backdrop-blur-sm rounded-b-xl'>
            <TabsList variant='outline'>
              <TabsTrigger value='details' variant='outline' size='sm'>
                <FileText />
                Details
              </TabsTrigger>
            </TabsList>

            {/* Details Tab */}
            <TabsContent value='details' className='flex-1 flex flex-col h-full rounded-b-xl'>
              <div className='flex-1 p-3'>
                {/* Preview Section */}
                <div>
                  <h4 className='text-sm font-medium mb-2'>Preview</h4>
                  <AttachmentPreview
                    type='file'
                    id={file.id}
                    version='current'
                    className='h-64'
                    interactive
                  />
                </div>
              </div>
              <div className='border-t bg-background/50 rounded-b-xl'>
                <CardHeader>
                  <CardTitle className='text-sm font-medium flex items-center gap-2 text-muted-foreground'>
                    <Folder className='size-4' />
                    <div className='text-xs font-semibold uppercase '>Location</div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='space-y-2 text-sm'>
                    <div className='flex justify-between gap-4'>
                      <span className='text-muted-foreground'>Path:</span>
                      <span className='font-medium truncate' title={file.path || '/'}>
                        {file.path || '/'}
                      </span>
                    </div>
                    <div className='flex justify-between gap-4'>
                      <span className='text-muted-foreground'>ID:</span>
                      <span className='font-medium truncate' title={file.id}>
                        {file.id}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </DockableDrawer>

      <ConfirmDialog />
    </>
  )
}
