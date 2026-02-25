// apps/web/src/app/(protected)/app/datasets/[datasetId]/_components/dataset-detail-provider.tsx
'use client'
import type {
  DatasetEntity as Dataset,
  DocumentEntity as Document,
  DocumentStatus,
} from '@auxx/database/types'
import { keepPreviousData } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useDebounce } from '~/hooks/use-debounced-value'
import { api } from '~/trpc/react'

interface DatasetDetailContextValue {
  // Dataset data
  dataset: Dataset | null
  documents: Document[]
  // Loading states
  isLoading: boolean
  isDocumentsLoading: boolean
  isError: boolean
  error: Error | null
  // Current view state
  currentTab: 'documents' | 'search' | 'analytics' | 'settings'
  setCurrentTab: (tab: 'documents' | 'search' | 'analytics' | 'settings') => void
  // Document filters
  documentFilter: DocumentStatus | 'all'
  setDocumentFilter: (filter: DocumentStatus | 'all') => void
  documentSearch: string
  setDocumentSearch: (search: string) => void
  // Search state
  searchQuery: string
  setSearchQuery: (query: string) => void
  // Pagination
  currentPage: number
  setCurrentPage: (page: number) => void
  pageSize: number
  totalDocuments: number
  // Upload dialog state
  uploadDialogOpen: boolean
  setUploadDialogOpen: (open: boolean) => void
  // Actions
  refetch: () => void
  refetchDocuments: () => void
  uploadDocuments: (files: File[]) => Promise<void>
  deleteDocument: (documentId: string) => Promise<void>
  reprocessDocument: (documentId: string) => Promise<void>
  updateDocument: (
    documentId: string,
    data: { title?: string; status?: 'INDEXED' | 'ARCHIVED'; enabled?: boolean }
  ) => Promise<void>
}
const DatasetDetailContext = createContext<DatasetDetailContextValue | null>(null)
export function useDatasetDetail() {
  const context = useContext(DatasetDetailContext)
  if (!context) {
    throw new Error('useDatasetDetail must be used within DatasetDetailProvider')
  }
  return context
}
interface DatasetDetailProviderProps {
  datasetId: string
  children: React.ReactNode
}
export function DatasetDetailProvider({ datasetId, children }: DatasetDetailProviderProps) {
  // View state - persisted in URL via nuqs
  const [currentTab, setCurrentTab] = useQueryState('tab', {
    defaultValue: 'documents',
  }) as ['documents' | 'search' | 'analytics' | 'settings', (tab: string) => void]
  // Document filters
  const [documentFilter, setDocumentFilter] = useState<DocumentStatus | 'all'>('all')
  const [documentSearch, setDocumentSearch] = useState('')
  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20
  // Upload dialog state
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const debouncedDocumentSearch = useDebounce(documentSearch, 300)
  // Fetch dataset details
  const {
    data: dataset,
    isLoading: isDatasetLoading,
    error: datasetError,
    refetch: refetchDataset,
  } = api.dataset.getById.useQuery(
    {
      id: datasetId,
      includeStats: true,
    },
    {
      retry: 2,
      staleTime: 5 * 60 * 1000, // 5 minutes
    }
  )
  // Fetch documents
  const {
    data: documentsData,
    isLoading: isDocumentsLoading,
    refetch: refetchDocuments,
  } = api.document.list.useQuery(
    {
      datasetId,
      status: documentFilter === 'all' ? undefined : documentFilter,
      search: debouncedDocumentSearch || undefined,
      page: currentPage,
      limit: pageSize,
    },
    {
      enabled: !!dataset,
      placeholderData: keepPreviousData,
    }
  )
  const documents = useMemo(() => {
    return documentsData?.documents || []
  }, [documentsData])
  const totalDocuments = useMemo(() => {
    return documentsData?.totalCount || 0
  }, [documentsData])
  // Upload documents using the proper file upload API
  const uploadDocuments = useCallback(
    async (files: File[]) => {
      const uploadPromises = files.map(async (file) => {
        const formData = new FormData()
        formData.append('file', file)
        const response = await fetch(`/api/datasets/${datasetId}/upload`, {
          method: 'POST',
          body: formData,
        })
        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Upload failed')
        }
        return response.json()
      })
      await Promise.all(uploadPromises)
      // Refetch data after successful upload
      refetchDocuments()
      refetchDataset()
    },
    [datasetId, refetchDocuments, refetchDataset]
  )
  // Delete document mutation
  const deleteDocumentMutation = api.document.delete.useMutation({
    onSuccess: () => {
      refetchDocuments()
      refetchDataset()
    },
  })
  const deleteDocument = useCallback(
    async (documentId: string) => {
      await deleteDocumentMutation.mutateAsync({ documentId })
    },
    [deleteDocumentMutation]
  )
  // Reprocess document mutation
  const reprocessDocumentMutation = api.document.reprocess.useMutation({
    onSuccess: () => {
      refetchDocuments()
    },
  })
  const reprocessDocument = useCallback(
    async (documentId: string) => {
      await reprocessDocumentMutation.mutateAsync({ documentId })
    },
    [reprocessDocumentMutation]
  )
  // Update document mutation
  const updateDocumentMutation = api.document.update.useMutation({
    onSuccess: () => {
      refetchDocuments()
    },
  })
  const updateDocument = useCallback(
    async (
      documentId: string,
      data: { title?: string; status?: 'INDEXED' | 'ARCHIVED'; enabled?: boolean }
    ) => {
      await updateDocumentMutation.mutateAsync({ documentId, ...data })
    },
    [updateDocumentMutation]
  )
  const refetch = useCallback(() => {
    refetchDataset()
    refetchDocuments()
  }, [refetchDataset, refetchDocuments])
  const contextValue: DatasetDetailContextValue = {
    // Dataset data
    dataset: dataset || null,
    documents,
    // Loading states
    isLoading: isDatasetLoading,
    isDocumentsLoading,
    isError: !!datasetError,
    error: datasetError,
    // Current view state
    currentTab,
    setCurrentTab,
    // Document filters
    documentFilter,
    setDocumentFilter,
    documentSearch,
    setDocumentSearch,
    // Search state
    searchQuery,
    setSearchQuery,
    // Pagination
    currentPage,
    setCurrentPage,
    pageSize,
    totalDocuments,
    // Upload dialog state
    uploadDialogOpen,
    setUploadDialogOpen,
    // Actions
    refetch,
    refetchDocuments,
    uploadDocuments,
    deleteDocument,
    reprocessDocument,
    updateDocument,
  }
  return (
    <DatasetDetailContext.Provider value={contextValue}>{children}</DatasetDetailContext.Provider>
  )
}
