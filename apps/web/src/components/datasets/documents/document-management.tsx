// apps/web/src/components/datasets/documents/document-management.tsx
'use client'
import { useCallback, useMemo, useState } from 'react'
import { Button } from '@auxx/ui/components/button'
import { DynamicTable } from '~/components/dynamic-table'
import { EmptyState } from '~/components/global/empty-state'
import { FileText, Plus, Trash2, CircleDot, CircleSlash } from 'lucide-react'
import { useDatasetDetail } from '~/app/(protected)/app/datasets/[datasetId]/_components/dataset-detail-provider'
import { DocumentUploadDialog } from './document-upload-dialog'
import { DocumentDetailDrawer } from './document-detail-drawer'
import { createDocumentColumns } from './document-columns'
import { DocumentFilterBar } from './document-filter-bar'
import { DocumentProcessingToast } from './document-processing-toast'
import { FileDropZone } from '~/components/files/file-drop-zone'
import { useFileUpload } from '~/components/file-upload/hooks/use-file-upload'
import { useDocumentProcessing } from '../hooks/use-document-processing'
import { useConfirm } from '~/hooks/use-confirm'
import { toastError, toastInfo, toastSuccess } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'
import type { DocumentEntity as Document } from '@auxx/database/models'

interface DocumentManagementProps {
  datasetId: string
  /**
   * Callback when a document is selected for viewing details.
   * When provided, the drawer is managed externally (parent controls open/close).
   */
  onDocumentSelect?: (document: Document) => void
}
export function DocumentManagement({ datasetId, onDocumentSelect }: DocumentManagementProps) {
  const {
    dataset,
    documents,
    isDocumentsLoading,
    documentFilter,
    setDocumentFilter,
    deleteDocument,
    reprocessDocument,
    updateDocument,
    refetch,
    totalDocuments,
    uploadDialogOpen,
    setUploadDialogOpen,
  } = useDatasetDetail()
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()

  // Get utils for cache invalidation
  const utils = api.useUtils()

  // Batch process mutation
  const batchProcess = api.document.batchProcess.useMutation()

  // Track document processing via SSE
  const {
    processingStates,
    activeCount,
    overallProgress,
    isProcessing,
    hasProcessingHistory,
    clearProcessingStates,
  } = useDocumentProcessing({
    datasetId,
    documents,
    onDocumentComplete: () => {
      // Individual document completed - we could do per-doc actions here if needed
    },
    onDocumentFailed: (_documentId, error) => {
      toastError({
        title: 'Processing failed',
        description: error,
      })
    },
    onAllComplete: () => {
      // All documents finished - invalidate queries once
      void utils.document.list.invalidate({ datasetId })
      void utils.dataset.getById.invalidate({ id: datasetId })
    },
  })

  // Initialize file upload hook for drag and drop
  const {
    addFiles,
    startUpload,
    isUploading: isUploadActive,
  } = useFileUpload({
    entityType: 'DATASET',
    entityId: datasetId,
    onComplete: (results) => {
      const { failedCount, successCount } = results

      // Invalidate document list so the new document appears immediately
      // (onAllComplete will refresh again after processing completes)
      void utils.document.list.invalidate({ datasetId })

      // Show completion message only for errors
      if (failedCount > 0) {
        toastError({
          title: 'Upload completed with errors',
          description: `${successCount} succeeded, ${failedCount} failed`,
        })
      }
    },
    onError: (error) => {
      toastError({
        title: 'Upload failed',
        description: error,
      })
    },
    autoStart: true,
    maxFiles: 20,
  })
  // Handle documents dropped for upload
  const handleDocumentsDropped = useCallback(
    async (files: File[]) => {
      try {
        console.log('Files dropped:', files)
        setIsUploading(true)
        await addFiles(files)
        await startUpload()
      } catch (error) {
        toastError({
          title: 'Upload failed',
          description: error instanceof Error ? error.message : 'Failed to upload documents',
        })
      } finally {
        setIsUploading(false)
      }
    },
    [addFiles, startUpload]
  )
  // Handle document view details
  const handleViewDetails = useCallback((document: Document) => {
    if (onDocumentSelect) {
      // External drawer management
      onDocumentSelect(document)
    } else {
      // Internal drawer management
      setSelectedDocument(document)
      setDetailDrawerOpen(true)
    }
  }, [onDocumentSelect])
  // Handle document download
  const handleDownload = useCallback((document: Document) => {
    // TODO: Implement actual download
  }, [])
  // Handle document deletion
  const handleDelete = useCallback(
    async (document: Document) => {
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
        } catch (error) {
          toastError({
            title: 'Failed to delete document',
            description: error instanceof Error ? error.message : 'An error occurred',
          })
        }
      }
    },
    [confirm, deleteDocument]
  )
  // Handle bulk document deletion
  const handleBulkDelete = useCallback(
    async (selectedDocs: Document[]) => {
      const confirmed = await confirm({
        title: 'Delete Documents',
        description: `Are you sure you want to delete ${selectedDocs.length} documents? This action cannot be undone.`,
        confirmText: 'Delete All',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed) {
        try {
          await Promise.all(selectedDocs.map((doc) => deleteDocument(doc.id)))
        } catch (error) {
          toastError({
            title: 'Failed to delete documents',
            description: error instanceof Error ? error.message : 'An error occurred',
          })
        }
      }
    },
    [confirm, deleteDocument]
  )
  // Handle bulk enable documents
  const handleBulkEnable = useCallback(
    async (selectedDocs: Document[]) => {
      try {
        const result = await batchProcess.mutateAsync({
          documentIds: selectedDocs.map((doc) => doc.id),
          operation: 'enable',
        })
        toastSuccess({
          title: 'Documents enabled',
          description: `${result.success} documents enabled successfully`,
        })
        refetch()
      } catch (error) {
        toastError({
          title: 'Failed to enable documents',
          description: error instanceof Error ? error.message : 'An error occurred',
        })
      }
    },
    [batchProcess, refetch]
  )
  // Handle bulk disable documents
  const handleBulkDisable = useCallback(
    async (selectedDocs: Document[]) => {
      try {
        const result = await batchProcess.mutateAsync({
          documentIds: selectedDocs.map((doc) => doc.id),
          operation: 'disable',
        })
        toastSuccess({
          title: 'Documents disabled',
          description: `${result.success} documents disabled successfully`,
        })
        refetch()
      } catch (error) {
        toastError({
          title: 'Failed to disable documents',
          description: error instanceof Error ? error.message : 'An error occurred',
        })
      }
    },
    [batchProcess, refetch]
  )
  // Handle document archive
  const handleArchive = useCallback(
    async (document: Document) => {
      try {
        await updateDocument(document.id, { status: 'ARCHIVED' })
      } catch (error) {
        toastError({
          title: 'Failed to archive document',
          description: error instanceof Error ? error.message : 'An error occurred',
        })
      }
    },
    [updateDocument]
  )
  // Handle document unarchive
  const handleUnarchive = useCallback(
    async (document: Document) => {
      try {
        await updateDocument(document.id, { status: 'INDEXED' })
      } catch (error) {
        toastError({
          title: 'Failed to unarchive document',
          description: error instanceof Error ? error.message : 'An error occurred',
        })
      }
    },
    [updateDocument]
  )
  // Column definitions with actions
  const columns = useMemo(
    () =>
      createDocumentColumns({
        onViewDetails: handleViewDetails,
        onDownload: handleDownload,
        onDelete: handleDelete,
        onArchive: handleArchive,
        onUnarchive: handleUnarchive,
      }),
    [handleViewDetails, handleDownload, handleDelete, handleArchive, handleUnarchive]
  )
  // Bulk actions
  const bulkActions = useMemo(
    () => [
      {
        label: 'Available',
        icon: CircleDot,
        variant: 'outline' as const,
        action: handleBulkEnable,
        disabled: () => false,
      },
      {
        label: 'Disabled',
        icon: CircleSlash,
        variant: 'outline' as const,
        action: handleBulkDisable,
        disabled: () => false,
      },
      {
        label: 'Delete Selected',
        icon: Trash2,
        variant: 'destructive' as const,
        action: handleBulkDelete,
        disabled: () => false,
      },
    ],
    [handleBulkEnable, handleBulkDisable, handleBulkDelete]
  )
  // Handle row click to view details
  const handleRowClick = useCallback(
    (document: Document) => {
      handleViewDetails(document)
    },
    [handleViewDetails]
  )
  // Handle export
  const handleExport = useCallback(() => {
    // TODO: Implement document export
    toastInfo({
      title: 'Export started',
      description: 'Document list export will be available soon.',
    })
  }, [])
  return (
    <FileDropZone
      onFilesDropped={handleDocumentsDropped}
      currentFolderName={dataset?.name || 'Dataset'}
      disabled={isDocumentsLoading || isUploading || isUploadActive}>
      {/* Dynamic Table */}
      <DynamicTable<Document>
        tableId="dataset-documents"
        className="h-full"
        columns={columns}
        data={documents}
        isLoading={isDocumentsLoading}
        onRowClick={handleRowClick}
        bulkActions={bulkActions}
        onRowSelectionChange={() => {}}
        onExport={handleExport}
        enableSearch
        onRefresh={refetch}
        searchPlaceholder="Search documents..."
        searchKeys={['filename', 'title', 'mimeType']}
        customFilter={
          <DocumentFilterBar
            filterValue={documentFilter}
            onFilterChange={setDocumentFilter}
            documents={documents}
            totalDocuments={totalDocuments}
          />
        }
        emptyState={
          <EmptyState
            icon={FileText}
            title={documentFilter !== 'all' ? 'No documents found' : 'No documents yet'}
            description={
              documentFilter !== 'all'
                ? 'Try adjusting your filters to find documents.'
                : 'Upload your first documents to get started with this dataset.'
            }
            button={
              documentFilter === 'all' ? (
                <Button onClick={() => setUploadDialogOpen(true)} variant="outline">
                  <Plus />
                  Upload Documents
                </Button>
              ) : undefined
            }
          />
        }
      />

      {/* Upload Dialog */}
      <DocumentUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        datasetId={datasetId}
      />

      {/* Document Detail Drawer - only render internally when not using external callback */}
      {!onDocumentSelect && selectedDocument && (
        <DocumentDetailDrawer
          document={selectedDocument}
          open={detailDrawerOpen}
          onOpenChange={setDetailDrawerOpen}
          datasetId={datasetId}
        />
      )}

      {/* Processing progress toast - show when there's any processing history */}
      {hasProcessingHistory && (
        <DocumentProcessingToast
          processingStates={processingStates}
          activeCount={activeCount}
          overallProgress={overallProgress}
          onDismiss={clearProcessingStates}
        />
      )}

      <ConfirmDialog />
    </FileDropZone>
  )
}
