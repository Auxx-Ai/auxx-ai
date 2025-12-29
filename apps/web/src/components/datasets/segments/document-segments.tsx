// apps/web/src/components/datasets/segments/document-segments.tsx
'use client'
import { Button } from '@auxx/ui/components/button'
import { useConfirm } from '~/hooks/use-confirm'
import { DocumentSegmentItem } from './document-segment-item'
import { useSegments } from './use-segments'
import { toastError } from '@auxx/ui/components/toast'
import {
  VirtualList,
  VirtualListHeader,
  VirtualListContent,
  VirtualListItems,
  VirtualListFooter,
} from '~/components/virtual-list'
import type { Document } from '@auxx/database/types'
interface DocumentSegmentsTabProps {
  document: Document & {
    _count?: {
      segments: number
    }
    segments?: Array<{
      id: string
      position: number
      content: string
      indexStatus: string
      tokenCount?: number | null
      enabled?: boolean
    }>
  }
  datasetId: string
  isLoadingDocument?: boolean
}
/**
 * Component for displaying and managing document segments with virtual scrolling
 */
export function DocumentSegmentsTab({ document, datasetId }: DocumentSegmentsTabProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const {
    segments,
    filteredSegments,
    selectedSegments,
    searchQuery,
    isLoading,
    isFetchingNextPage,
    hasMore,
    totalCount,
    loadedCount,
    isLoadingAll,
    handleSearch,
    handleSelectionChange,
    handleSelectAll,
    handleSearchClear,
    loadMore,
    loadAll,
    batchDelete,
    batchToggleEnabled,
  } = useSegments(document.id)
  /**
   * Handle batch delete of selected segments
   */
  const handleBatchDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete Selected Segments',
      description: `Are you sure you want to delete ${selectedSegments.size} segments? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) {
      try {
        await batchDelete()
      } catch (error) {
        toastError({
          title: 'Failed to delete segments',
          description: error instanceof Error ? error.message : 'An error occurred',
        })
      }
    }
  }
  /**
   * Handle batch enable of selected segments
   */
  const handleBatchEnable = async () => {
    try {
      await batchToggleEnabled(true)
    } catch (error) {
      toastError({
        title: 'Failed to enable segments',
        description: error instanceof Error ? error.message : 'An error occurred',
      })
    }
  }
  /**
   * Handle batch disable of selected segments
   */
  const handleBatchDisable = async () => {
    try {
      await batchToggleEnabled(false)
    } catch (error) {
      toastError({
        title: 'Failed to disable segments',
        description: error instanceof Error ? error.message : 'An error occurred',
      })
    }
  }
  return (
    <>
      <VirtualList
        items={filteredSegments}
        selectedItems={selectedSegments}
        searchQuery={searchQuery}
        isLoading={isLoading}
        hasMore={hasMore}
        onSearch={handleSearch}
        onSelectionChange={handleSelectionChange}
        onSelectAll={handleSelectAll}
        onLoadMore={loadMore}
        estimateSize={150} // Estimated height of each segment item
        overscan={5} // Number of items to render outside visible area
        getItemKey={(segment) => segment.id}
        className="">
        <VirtualListHeader
          searchPlaceholder="Search segments by content or position..."
          selectAllLabel="Select all segments">
          {/* Batch action buttons */}
          {selectedSegments.size > 0 && (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={handleBatchEnable}>
                Enable Selected
              </Button>
              <Button size="sm" variant="ghost" onClick={handleBatchDisable}>
                Disable Selected
              </Button>
              <Button size="sm" variant="ghost" onClick={handleBatchDelete}>
                Delete Selected
              </Button>
            </div>
          )}
        </VirtualListHeader>

        <VirtualListContent
          emptyMessage={
            searchQuery ? `No segments match "${searchQuery}"` : 'No segments available'
          }
          loadingMessage="Loading segments...">
          <VirtualListItems
            renderItem={(segment) => (
              <div className="px-4 py-2">
                <DocumentSegmentItem
                  segment={{
                    ...segment,
                    tokenCount: segment.tokenCount || Math.ceil(segment.content.length / 4),
                    enabled: segment.enabled ?? true,
                  }}
                  documentId={document.id}
                  datasetId={datasetId}
                  isSelected={selectedSegments.has(segment.id)}
                  isBulkSelectionMode={selectedSegments.size > 0}
                  onSelectionChange={(selected) => handleSelectionChange(segment.id, selected)}
                  highlightText={searchQuery}
                />
              </div>
            )}
            getItemId={(segment) => segment.id}
          />
        </VirtualListContent>

        <VirtualListFooter showItemCount={false}>
          <div className="flex justify-between items-center w-full">
            <span className="text-sm text-muted-foreground">
              {searchQuery ? (
                <>Found {filteredSegments.length} matches</>
              ) : (
                <>
                  Showing {filteredSegments.length} of {totalCount} segments
                </>
              )}
              {isFetchingNextPage && ' (loading more...)'}
            </span>
            {searchQuery && (
              <Button variant="link" size="sm" onClick={handleSearchClear}>
                Clear search
              </Button>
            )}
          </div>
        </VirtualListFooter>
      </VirtualList>

      <ConfirmDialog />
    </>
  )
}
