// apps/web/src/app/(protected)/app/rules/_components/testing/test-suite-content.tsx
'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  PlayCircle,
  Copy,
  Trash2,
  CheckCircle,
  TestTube,
  Hash,
  Tag,
  Calendar,
  MoreVertical,
  Pencil,
  FlaskConical,
} from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { DynamicTable, type ExtendedColumnDef, type BulkAction } from '~/components/dynamic-table'
import { useTestingContext } from './testing-provider'
import type { TestCase } from './testing-provider'
import { api } from '~/trpc/react'
import { toastSuccess, toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { EmptyState } from '~/components/global/empty-state'

export function TestSuiteContent() {
  const { testCases, selectedTestCases, runTests, isLoadingTestCases } = useTestingContext()
  const router = useRouter()
  const [confirm, ConfirmDialog] = useConfirm()

  const utils = api.useUtils()
  const handleRunTestCase = async (testCaseId: string) => {
    await runTests({
      testCaseIds: [testCaseId],
      skipSpamDetection: true,
      skipInternalExternal: true,
    })
  }

  const duplicateTestCase = api.testCase.duplicate.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Test case duplicated',
        description: 'The test case has been successfully duplicated',
      })
    },
    onError: (error) => {
      toastError({ title: 'Failed to duplicate test case', description: error.message })
    },
  })

  const deleteTestCase = api.testCase.delete.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'Test case deleted',
        description: 'The test case has been successfully deleted',
      })
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete test case', description: error.message })
    },
  })

  const bulkDuplicateTestCases = api.testCase.bulkDuplicate.useMutation({
    onSuccess: (data) => {
      toastSuccess({ title: 'Test cases duplicated', description: data.message })
    },
    onError: (error) => {
      toastError({ title: 'Failed to duplicate test cases', description: error.message })
    },
  })

  const bulkDeleteTestCases = api.testCase.bulkDelete.useMutation({
    onSuccess: (data) => {
      toastSuccess({ title: 'Test cases deleted', description: data.message })
    },
    onError: (error) => {
      toastError({ title: 'Failed to delete test cases', description: error.message })
    },
  })

  const handleDuplicateTestCase = async (testCase: TestCase) => {
    try {
      await duplicateTestCase.mutateAsync({ id: testCase.id })
      await utils.testCase.invalidate() // Invalidate cache to refresh test case list
    } catch (error) {
      // Error is handled by the mutation onError callback
    }
  }

  const handleDeleteTestCase = async (testCase: TestCase) => {
    const confirmed = await confirm({
      title: 'Delete test case?',
      description: `Are you sure you want to delete "${testCase.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      try {
        await deleteTestCase.mutateAsync({ id: testCase.id })
        await utils.testCase.invalidate() // Invalidate cache to refresh test case list
      } catch (error) {
        // Error is handled by the mutation onError callback
      }
    }
  }

  // Handle row selection change
  // const handleRowSelectionChange = (selectedRows: Set<string>) => {
  //   // Update selected test cases in context if needed
  //   console.log('Selected rows:', selectedRows)
  // }

  // Define bulk actions
  const bulkActions: BulkAction<TestCase>[] = useMemo(
    () => [
      {
        label: 'Run Selected',
        icon: PlayCircle,
        variant: 'default',
        action: async (rows: TestCase[]) => {
          const testCaseIds = rows.map((row) => row.id)
          await runTests({
            testCaseIds,
            parallel: true,
            skipSpamDetection: true,
            skipInternalExternal: true,
          })
        },
      },
      {
        label: 'Duplicate',
        icon: Copy,
        variant: 'outline',
        action: async (rows: TestCase[]) => {
          const ids = rows.map((row) => row.id)
          try {
            await bulkDuplicateTestCases.mutateAsync({ ids })
            await utils.testCase.invalidate() // Invalidate cache to refresh test case list
          } catch (error) {
            // Error is handled by the mutation onError callback
          }
        },
      },
      {
        label: 'Delete',
        icon: Trash2,
        variant: 'destructive',
        action: async (rows: TestCase[]) => {
          const ids = rows.map((row) => row.id)
          const confirmed = await confirm({
            title: `Delete ${rows.length} test cases?`,
            description: `Are you sure you want to delete ${rows.length} test case${rows.length === 1 ? '' : 's'}? This action cannot be undone.`,
            confirmText: 'Delete',
            cancelText: 'Cancel',
            destructive: true,
          })

          if (confirmed) {
            try {
              await bulkDeleteTestCases.mutateAsync({ ids })
              await utils.testCase.invalidate() // Invalidate cache to refresh test case list
            } catch (error) {
              // Error is handled by the mutation onError callback
            }
          }
        },
      },
    ],
    [runTests, bulkDuplicateTestCases, bulkDeleteTestCases, confirm]
  )

  // Define columns
  const columns: ExtendedColumnDef<TestCase>[] = useMemo(
    () => [
      {
        accessorKey: 'name',
        id: 'name',
        header: 'Name',
        columnType: 'text',
        icon: TestTube,
        enableSorting: true,
        enableFiltering: true,
        minSize: 200,
        cell: ({ row }) => <div className="truncate">{row.original.name}</div>,
      },
      {
        accessorKey: 'tags',
        id: 'tags',
        header: 'Tags',
        columnType: 'custom',
        icon: Tag,
        enableFiltering: false,
        cell: ({ row }) => (
          <div className="flex gap-1 flex-row">
            {row.original.tags.map((tag) => (
              <Badge key={tag} variant="secondary" size="sm">
                {tag}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        accessorKey: 'status',
        id: 'status',
        header: 'Status',
        columnType: 'select',
        enableSorting: true,
        enableFiltering: true,
        cell: ({ row }) => (
          <Badge variant={row.original.status === 'ACTIVE' ? 'green' : 'secondary'}>
            {row.original.status.toLowerCase()}
          </Badge>
        ),
      },
      {
        id: 'lastRun',
        header: 'Last Run',
        columnType: 'custom',
        cell: () => (
          // Placeholder for last run result - TODO: implement actual last run data
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span className="text-sm">Passed</span>
          </div>
        ),
      },
      {
        accessorKey: 'version',
        id: 'version',
        header: 'Version',
        columnType: 'number',
        icon: Hash,
        enableSorting: true,
        minSize: 80,
        maxSize: 100,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">v{row.original.version}</span>
        ),
      },
      {
        accessorKey: 'createdAt',
        id: 'createdAt',
        header: 'Created',
        columnType: 'date',
        icon: Calendar,
        enableSorting: true,
        enableFiltering: true,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {new Date(row.original.createdAt).toLocaleDateString()}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableFiltering: false,
        enableResize: false,
        minSize: 50,
        maxSize: 50,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="-mt-2.5">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleRunTestCase(row.original.id)}>
                <PlayCircle />
                Run Test
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => router.push(`/app/rules/testing/${row.original.id}/edit`)}>
                <Pencil />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDuplicateTestCase(row.original)}>
                <Copy />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => handleDeleteTestCase(row.original)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [handleRunTestCase, handleDuplicateTestCase, handleDeleteTestCase]
  )

  return (
    <>
      <DynamicTable
        data={testCases}
        columns={columns}
        tableId="test-cases"
        className="h-full"
        bulkActions={bulkActions}
        enableSearch
        enableFiltering
        enableSorting
        isLoading={isLoadingTestCases}
        getRowId={(row) => row.id}
        emptyState={<EmptyStateComponent />}
      />
      <ConfirmDialog />
    </>
  )
}

function EmptyStateComponent() {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon={FlaskConical}
        title="No tests found "
        description={<>Create your first Test</>}
      />
    </div>
  )
}
