// apps/web/src/components/datasets/documents/document-detail-drawer.tsx
'use client'
import type { DocumentEntity as Document } from '@auxx/database/models'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { DockableDrawer } from '@auxx/ui/components/dockable-drawer'
import { DrawerHeader } from '@auxx/ui/components/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { EntityIcon } from '@auxx/ui/components/icons'
import { Input } from '@auxx/ui/components/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@auxx/ui/components/tabs'
import { toastError, toastInfo } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { formatBytes } from '@auxx/utils/file'
import { format, formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Calendar,
  Database,
  Download,
  FileText,
  Hash,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  TextCursorInput,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDatasetDetail } from '~/app/(protected)/app/datasets/[datasetId]/_components/dataset-detail-provider'
import { AttachmentPreview } from '~/components/attachments/attachment-preview'
import { DockToggleButton } from '~/components/global/dock-toggle-button'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import { DocumentSegmentsTab } from '../segments/document-segments'
import { DocumentMetadataTab } from './document-metadata'
import { DocumentStatus } from './document-utils'

interface DocumentDetailDrawerProps {
  document: Document & {
    _count?: {
      segments: number
    }
    segments?: Array<{
      id: string
      position: number
      content: string
      indexStatus: string
    }>
  }
  open: boolean
  onOpenChange: (open: boolean) => void
  datasetId: string
}
const KeyboardShortcut = ({ shortcut }: { shortcut: string }) => (
  <span className='ml-auto pl-2 text-xs text-muted-foreground'>{shortcut}</span>
)
export function DocumentDetailDrawer({
  document,
  open,
  onOpenChange,
  datasetId,
}: DocumentDetailDrawerProps) {
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)

  const { deleteDocument, reprocessDocument, updateDocument } = useDatasetDetail()
  const [confirm, ConfirmDialog] = useConfirm()
  const [editingTitle, setEditingTitle] = useState(document.title || document.filename || '')
  const [isRenaming, setIsRenaming] = useState(false)
  const [originalTitle, setOriginalTitle] = useState(document.title || document.filename || '')

  // Get utils for cache invalidation
  const utils = api.useUtils()

  /** Handle close */
  const handleClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  // Fetch full document details with segments when drawer is open
  const { data: fullDocument, isLoading: isLoadingDocument } = api.document.getById.useQuery(
    { documentId: document.id },
    { enabled: open && !!document.id }
  )

  // Use full document data if available, otherwise use the passed document
  const displayDocument = fullDocument || document

  // Reset state when document changes
  useEffect(() => {
    setEditingTitle(displayDocument.title || displayDocument.filename || '')
    setOriginalTitle(displayDocument.title || displayDocument.filename || '')
  }, [document.id, displayDocument.title, displayDocument.filename])
  // Update mutation (for renaming)
  const updateDocumentMutation = api.document.update.useMutation({
    onSuccess: () => {
      setIsRenaming(false)
      // Invalidate the document list to refresh the table
      utils.document.list.invalidate({ datasetId })
      // Also invalidate the specific document query
      utils.document.getById.invalidate({ documentId: document.id })
    },
    onError: (error) => {
      setEditingTitle(originalTitle)
      setIsRenaming(false)
      toastError({
        title: 'Failed to rename document',
        description: error.message,
      })
    },
  })
  const handleRename = async () => {
    const trimmedTitle = editingTitle.trim()
    if (!trimmedTitle) {
      toastError({
        title: 'Invalid title',
        description: 'Title cannot be empty',
      })
      setEditingTitle(originalTitle)
      return
    }
    if (trimmedTitle === originalTitle) {
      setIsRenaming(false)
      return
    }
    setOriginalTitle(displayDocument.title || displayDocument.filename || '')
    setIsRenaming(true)
    updateDocumentMutation.mutate({
      documentId: document.id,
      title: trimmedTitle,
    })
  }
  const handleTitleBlur = () => {
    handleRename()
  }
  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEditingTitle(originalTitle)
      setIsRenaming(false)
    }
  }
  const handleDownload = () => {
    // TODO: Implement actual download
    toastInfo({ title: 'Download started', description: `Downloading ${document.filename}` })
  }
  const handleReprocess = async () => {
    const confirmed = await confirm({
      title: 'Reprocess Document',
      description:
        'Are you sure you want to reprocess this document? This will re-extract text and regenerate embeddings.',
      confirmText: 'Reprocess',
      cancelText: 'Cancel',
    })
    if (confirmed) {
      try {
        // Trigger reprocess (this updates status to PROCESSING)
        await reprocessDocument(document.id)
        // Invalidate to refresh the document data
        void utils.document.getById.invalidate({ documentId: document.id })
        void utils.document.list.invalidate({ datasetId })
      } catch (error) {
        toastError({
          title: 'Failed to reprocess document',
          description: error instanceof Error ? error.message : 'An error occurred',
        })
      }
    }
  }
  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete Document',
      description: `Are you sure you want to delete "${document.filename}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      try {
        await deleteDocument(document.id)
        onOpenChange(false) // Close drawer after deletion
      } catch (error) {
        toastError({
          title: 'Failed to delete document',
          description: error instanceof Error ? error.message : 'An error occurred',
        })
      }
    }
  }
  const segmentCount = displayDocument.totalChunks ?? 0
  if (!document) return null
  return (
    <>
      <DockableDrawer
        open={open}
        onOpenChange={onOpenChange}
        isDocked={isDocked}
        width={dockedWidth}
        onWidthChange={setDockedWidth}
        minWidth={400}
        maxWidth={600}
        title={displayDocument.title || displayDocument.filename || 'Document'}>
        {/* Content */}
        <div className='flex-1 h-full flex flex-col rounded-t-xl'>
          <DrawerHeader
            icon={<EntityIcon iconId='file-text' color='blue' className='size-6' />}
            title={
              <Input
                id='title'
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={handleTitleKeyDown}
                placeholder='Enter title'
                disabled={isRenaming || updateDocumentMutation.isPending}
                className={cn(
                  'mr-2 h-7 min-w-0 w-full appearance-none rounded-md border bg-transparent px-1 outline-none',
                  'border-transparent',
                  'focus:shadow-xs',
                  (isRenaming || updateDocumentMutation.isPending) &&
                    'opacity-50 cursor-not-allowed'
                )}
              />
            }
            onClose={handleClose}
            actions={
              <>
                <DocumentStatus status={displayDocument.status} size='sm' />
                <Tooltip content='Download'>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    className='rounded-full'
                    onClick={handleDownload}>
                    <Download />
                  </Button>
                </Tooltip>
                <Tooltip content='Reprocess file'>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    className='rounded-full'
                    loading={displayDocument.status === 'PROCESSING'}
                    onClick={handleReprocess}>
                    <RefreshCw />
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
                      onClick={() => {
                        // Focus the input to start renaming
                        const input = window.document.getElementById('title') as HTMLInputElement
                        if (input) {
                          input.focus()
                          input.select()
                        }
                      }}>
                      <TextCursorInput />
                      Rename
                    </DropdownMenuItem>

                    {displayDocument.status === 'ARCHIVED' ? (
                      <DropdownMenuItem
                        onClick={() => updateDocument(document.id, { status: 'INDEXED' })}>
                        <ArchiveRestore />
                        Unarchive
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onClick={() => updateDocument(document.id, { status: 'ARCHIVED' })}>
                        <Archive />
                        Archive
                      </DropdownMenuItem>
                    )}

                    <DropdownMenuItem onClick={() => handleDelete()} variant='destructive'>
                      <Trash2 />
                      Delete
                      <KeyboardShortcut shortcut='Del' />
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DockToggleButton />
              </>
            }
          />

          {/* Metrics */}
          <div className='grid grid-cols-2 border-b'>
            {/* File Size */}
            <div className='border-r border-b'>
              <CardHeader className='pb-2 pt-3'>
                <CardTitle className='text-sm font-medium text-muted-foreground'>
                  File Size
                </CardTitle>
              </CardHeader>
              <CardContent className='pb-3'>
                <div className='flex items-center gap-2'>
                  <Database className='size-4 text-muted-foreground' />
                  <span className='text-lg font-semibold'>
                    {formatBytes(Number(displayDocument.size))}
                  </span>
                </div>
              </CardContent>
            </div>

            {/* Segments */}
            <div className='border-b'>
              <CardHeader className='pb-2 pt-3'>
                <CardTitle className='text-sm font-medium text-muted-foreground'>
                  Segments
                </CardTitle>
              </CardHeader>
              <CardContent className='pb-3'>
                <div className='flex items-center gap-2'>
                  <Hash className='size-4 text-muted-foreground' />
                  <span className='text-lg font-semibold'>{segmentCount}</span>
                </div>
                {displayDocument.status === 'PROCESSING' && segmentCount > 0 && (
                  <p className='text-xs text-muted-foreground mt-1'>Processing</p>
                )}
              </CardContent>
            </div>

            {/* Upload Date */}
            <div className='border-r'>
              <CardHeader className='pb-2 pt-3'>
                <CardTitle className='text-sm font-medium text-muted-foreground'>
                  Uploaded
                </CardTitle>
              </CardHeader>
              <CardContent className='pb-3'>
                <div className='flex items-center gap-2'>
                  <Calendar className='size-4 text-muted-foreground' />
                  <div>
                    <div className='text-sm font-medium'>
                      {formatDistanceToNow(new Date(displayDocument.createdAt), {
                        addSuffix: true,
                      })}
                    </div>
                    <div className='text-xs text-muted-foreground'>
                      {format(new Date(displayDocument.createdAt), 'MMM d, yyyy HH:mm')}
                    </div>
                  </div>
                </div>
              </CardContent>
            </div>

            {/* File Type */}
            <div>
              <CardHeader className='pb-2 pt-3'>
                <CardTitle className='text-sm font-medium text-muted-foreground'>
                  File Type
                </CardTitle>
              </CardHeader>
              <CardContent className='pb-3'>
                <div className='flex items-center gap-2'>
                  <FileText className='size-4 text-muted-foreground' />
                  <span className='text-sm font-medium'>
                    {displayDocument.mimeType?.split('/')[1]?.toUpperCase() || 'Unknown'}
                  </span>
                </div>
                <p className='text-xs text-muted-foreground mt-1'>
                  {displayDocument.mimeType || 'Unknown MIME type'}
                </p>
              </CardContent>
            </div>
          </div>

          {/* Tabs */}
          <Tabs defaultValue='preview' className='flex-1 flex flex-col min-h-0'>
            <TabsList variant='outline'>
              <TabsTrigger value='preview' variant='outline' size='sm'>
                Preview
              </TabsTrigger>
              <TabsTrigger value='segments' variant='outline' size='sm'>
                Segments ({segmentCount})
              </TabsTrigger>
              <TabsTrigger value='metadata' variant='outline' size='sm'>
                Metadata
              </TabsTrigger>
            </TabsList>

            {/* Preview Tab */}
            <TabsContent value='preview' className='flex-1 flex flex-col min-h-0'>
              <div className='p-4 h-full'>
                {displayDocument.status === 'PROCESSING' ? (
                  <div className='flex flex-col items-center justify-center h-64'>
                    <Loader2 className='h-8 w-8 animate-spin text-yellow-600 mb-4' />
                    <p className='text-sm text-muted-foreground'>Processing document...</p>
                    <p className='text-xs text-muted-foreground mt-2'>
                      Preview will be available once processing is complete
                    </p>
                  </div>
                ) : displayDocument.status === 'FAILED' ? (
                  <Alert variant='destructive'>
                    <AlertTriangle className='size-4' />
                    <AlertDescription>
                      Document processing failed. Preview is not available.
                      {displayDocument.errorMessage && (
                        <p className='mt-1 text-xs'>{displayDocument.errorMessage}</p>
                      )}
                    </AlertDescription>
                  </Alert>
                ) : displayDocument.mediaAssetId ? (
                  <AttachmentPreview
                    type='asset'
                    id={displayDocument.mediaAssetId}
                    version='current'
                    className='h-full min-h-[400px]'
                    interactive
                  />
                ) : (
                  <div className='flex flex-col items-center justify-center h-64 text-center'>
                    <FileText className='h-12 w-12 text-muted-foreground mb-2' />
                    <p className='text-muted-foreground'>Preview not available</p>
                    <p className='text-xs text-muted-foreground mt-1'>
                      This document doesn't have an associated media asset
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Segments Tab */}
            <TabsContent value='segments' className='flex-1 flex flex-col min-h-0'>
              <DocumentSegmentsTab
                document={displayDocument}
                datasetId={datasetId}
                isLoadingDocument={isLoadingDocument}
              />
            </TabsContent>

            {/* Metadata Tab */}
            <TabsContent value='metadata' className='mt-0'>
              <DocumentMetadataTab document={displayDocument} />
            </TabsContent>
          </Tabs>
        </div>
      </DockableDrawer>

      <ConfirmDialog />
    </>
  )
}
