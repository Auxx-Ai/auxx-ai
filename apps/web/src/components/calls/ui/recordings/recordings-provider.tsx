// apps/web/src/components/calls/ui/recordings/recordings-provider.tsx
'use client'

import { type BotStatus, TERMINAL_STATUSES } from '@auxx/lib/recording/client'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { endOfDay, startOfDay } from 'date-fns'
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { USE_MOCK_DATA } from '../../constants'
import { MOCK_RECORDINGS } from './recordings-mocks'
import type { Recording, RecordingsFilter } from './recordings-types'

interface RecordingsContextType {
  items: Recording[]
  isLoading: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean

  filter: RecordingsFilter
  setFilter: (filter: RecordingsFilter | ((prev: RecordingsFilter) => RecordingsFilter)) => void

  fetchNextPage: () => void
  refetch: () => void

  handleCancelRun: (recording: Recording) => void
  handleDeleteRun: (recording: Recording) => void
  handleBulkCancel: (recordingIds: string[]) => void
  handleBulkDelete: (recordingIds: string[]) => void
  handleExport: (rows: Recording[]) => void
}

const RecordingsContext = createContext<RecordingsContextType | undefined>(undefined)

export function RecordingsProvider({ children }: { children: ReactNode }) {
  const [confirm, ConfirmDialog] = useConfirm()

  const [filter, setFilter] = useState<RecordingsFilter>({ status: 'all' })

  const queryInput = useMemo(() => {
    const params: {
      limit: number
      status?: BotStatus
      fromDate?: Date
      toDate?: Date
    } = { limit: 20 }
    if (filter.status !== 'all') {
      params.status = filter.status
    }
    if (filter.startDate) {
      params.fromDate = startOfDay(filter.startDate)
    }
    if (filter.endDate) {
      params.toDate = endOfDay(filter.endDate)
    }
    return params
  }, [filter.status, filter.startDate, filter.endDate])

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    api.recording.list.useInfiniteQuery(queryInput, {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      refetchOnWindowFocus: false,
      enabled: !USE_MOCK_DATA,
    })

  const items: Recording[] = USE_MOCK_DATA
    ? MOCK_RECORDINGS
    : (data?.pages.flatMap((page) => page.items) ?? [])

  const cancelRecording = api.recording.cancel.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Recording cancelled' })
      refetch()
    },
    onError: (error) => {
      toastError({ title: 'Failed to cancel recording', description: error.message })
    },
  })

  const deleteRecording = api.recording.delete.useMutation({
    onSuccess: () => {
      toastSuccess({ title: 'Recording deleted' })
      refetch()
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete recording', description: error.message })
    },
  })

  const handleCancelRun = useCallback(
    async (recording: Recording) => {
      if (TERMINAL_STATUSES.includes(recording.status as BotStatus)) {
        toastError({ title: 'Only active recordings can be cancelled' })
        return
      }
      const confirmed = await confirm({
        title: 'Cancel Recording?',
        description: `This will cancel the recording "${recording.id.slice(-8)}".`,
        confirmText: 'Cancel Recording',
        cancelText: 'Keep',
        destructive: true,
      })
      if (!confirmed) return
      await cancelRecording.mutateAsync({ id: recording.id }).catch(() => {})
    },
    [confirm, cancelRecording]
  )

  const handleDeleteRun = useCallback(
    async (recording: Recording) => {
      if (!TERMINAL_STATUSES.includes(recording.status as BotStatus)) {
        toastError({ title: 'Cancel the recording before deleting it' })
        return
      }
      const confirmed = await confirm({
        title: 'Delete Recording?',
        description: `This will permanently delete the recording "${recording.id.slice(-8)}" and its media files. This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
      await deleteRecording.mutateAsync({ id: recording.id }).catch(() => {})
    },
    [confirm, deleteRecording]
  )

  const handleBulkCancel = useCallback(
    async (recordingIds: string[]) => {
      const targets = items.filter(
        (item) =>
          recordingIds.includes(item.id) && !TERMINAL_STATUSES.includes(item.status as BotStatus)
      )
      if (targets.length === 0) {
        toastError({ title: 'No active recordings selected' })
        return
      }
      const confirmed = await confirm({
        title: `Cancel ${targets.length} recordings?`,
        description: 'This will cancel all selected active recordings.',
        confirmText: 'Cancel All',
        cancelText: 'Keep',
        destructive: true,
      })
      if (!confirmed) return
      for (const recording of targets) {
        await cancelRecording.mutateAsync({ id: recording.id }).catch(() => {})
      }
    },
    [confirm, items, cancelRecording]
  )

  const handleBulkDelete = useCallback(
    async (recordingIds: string[]) => {
      const targets = items.filter(
        (item) =>
          recordingIds.includes(item.id) && TERMINAL_STATUSES.includes(item.status as BotStatus)
      )
      if (targets.length === 0) {
        toastError({ title: 'No completed recordings selected' })
        return
      }
      const confirmed = await confirm({
        title: `Delete ${targets.length} recordings?`,
        description: 'This will permanently delete all selected recordings and their media files.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
      for (const recording of targets) {
        await deleteRecording.mutateAsync({ id: recording.id }).catch(() => {})
      }
    },
    [confirm, items, deleteRecording]
  )

  const handleExport = useCallback((rows: Recording[]) => {
    const headers = [
      'ID',
      'Title',
      'Platform',
      'Status',
      'Duration (s)',
      'Started At',
      'Ended At',
      'Created At',
    ]
    const csvRows = rows.map((row) => [
      row.id,
      row.calendarEvent?.title ?? row.botName ?? '',
      row.meetingPlatform,
      row.status,
      row.durationSeconds ?? '',
      row.startedAt?.toISOString() ?? '',
      row.endedAt?.toISOString() ?? '',
      row.createdAt.toISOString(),
    ])
    const csv = [
      headers.join(','),
      ...csvRows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `recordings-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toastSuccess({ title: 'Recordings exported' })
  }, [])

  const contextValue: RecordingsContextType = {
    items,
    isLoading: USE_MOCK_DATA ? false : isLoading,
    isFetchingNextPage,
    hasNextPage: hasNextPage ?? false,
    filter,
    setFilter,
    fetchNextPage: () => fetchNextPage(),
    refetch,
    handleCancelRun,
    handleDeleteRun,
    handleBulkCancel,
    handleBulkDelete,
    handleExport,
  }

  return (
    <RecordingsContext.Provider value={contextValue}>
      {children}
      <ConfirmDialog />
    </RecordingsContext.Provider>
  )
}

export function useRecordings() {
  const context = useContext(RecordingsContext)
  if (context === undefined) {
    throw new Error('useRecordings must be used within a RecordingsProvider')
  }
  return context
}
