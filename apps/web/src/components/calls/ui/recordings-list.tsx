// apps/web/src/components/calls/ui/recordings-list.tsx
'use client'

import { StopCircle, Trash2, Video } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { DynamicTable } from '~/components/dynamic-table'
import { EmptyState } from '~/components/global/empty-state'
import { createRecordingsColumns } from './recordings/recordings-columns'
import { RecordingsFilterBar } from './recordings/recordings-filter-bar'
import { RecordingsProvider, useRecordings } from './recordings/recordings-provider'
import type { Recording } from './recordings/recordings-types'

export function RecordingsList() {
  return (
    <RecordingsProvider>
      <RecordingsListContent />
    </RecordingsProvider>
  )
}

function RecordingsListContent() {
  const router = useRouter()
  const {
    items,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    filter,
    setFilter,
    handleCancelRun,
    handleDeleteRun,
    handleBulkCancel,
    handleBulkDelete,
    handleExport,
  } = useRecordings()

  const columns = useMemo(
    () =>
      createRecordingsColumns({
        onView: (recording) => router.push(`/app/calls/recordings/${recording.id}`),
        onCancel: handleCancelRun,
        onDelete: handleDeleteRun,
      }),
    [router, handleCancelRun, handleDeleteRun]
  )

  const bulkActions = useMemo(
    () => [
      {
        label: 'Cancel Selected',
        icon: StopCircle,
        action: (rows: Recording[]) => handleBulkCancel(rows.map((r) => r.id)),
      },
      {
        label: 'Delete Selected',
        icon: Trash2,
        variant: 'destructive' as const,
        action: (rows: Recording[]) => handleBulkDelete(rows.map((r) => r.id)),
      },
    ],
    [handleBulkCancel, handleBulkDelete]
  )

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <DynamicTable<Recording>
      tableId='recordings'
      className='h-full'
      columns={columns}
      data={items}
      isLoading={isLoading}
      bulkActions={bulkActions}
      onScrollToBottom={handleLoadMore}
      onExport={handleExport}
      customFilter={<RecordingsFilterBar filter={filter} setFilter={setFilter} />}
      emptyState={
        <EmptyState
          icon={Video}
          title='No recordings yet'
          description='Recordings will appear here when you record meetings.'
        />
      }
    />
  )
}
