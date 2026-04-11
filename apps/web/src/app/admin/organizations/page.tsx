// apps/web/src/app/admin/organizations/page.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Input } from '@auxx/ui/components/input'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { Skeleton } from '@auxx/ui/components/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { toastError } from '@auxx/ui/components/toast'
import { pluralize } from '@auxx/utils/strings'
import { formatDistanceToNow } from 'date-fns'
import { ChevronLeft, ChevronRight, Database, Search, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

const PAGE_SIZE = 50

/**
 * Organizations list page for admin
 */
export default function OrganizationsPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const { data, isLoading } = api.admin.getOrganizations.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    search: search || undefined,
  })

  const orgIds = data?.map((org) => org.id) ?? []
  const { data: demoStats } = api.admin.getActiveDemoCount.useQuery()

  const { data: usageSummary } = api.admin.getOrganizationsUsageSummary.useQuery(
    { organizationIds: orgIds },
    { enabled: orgIds.length > 0 }
  )
  const usageMap = new Map(usageSummary?.map((u) => [u.organizationId, u]))

  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const runMigrations = api.admin.runEntityMigrations.useMutation({
    onSuccess: (data) => {
      const totalCreated = data.results.reduce(
        (acc, r) =>
          acc +
          r.migrations.reduce((a, m) => a + m.result.entityDefsCreated + m.result.fieldsCreated, 0),
        0
      )
      const errors = data.results.filter((r) => r.error).length
      toast.success('Entity migrations complete', {
        description:
          errors > 0
            ? `${totalCreated} records created, ${errors} org(s) had errors`
            : totalCreated > 0
              ? `${totalCreated} records created across ${data.results.length} org(s)`
              : `All ${data.results.length} org(s) already up to date`,
      })
    },
    onError: (error) => {
      toastError({ title: 'Migration failed', description: error.message })
    },
  })

  const handleRunMigrations = async () => {
    const confirmed = await confirm({
      title: 'Run entity migrations?',
      description:
        'This will create missing EntityDefinitions and CustomFields for all organizations. Each migration is idempotent and safe to re-run.',
      confirmText: 'Run Migrations',
      cancelText: 'Cancel',
    })

    if (confirmed) {
      await runMigrations.mutateAsync()
    }
  }

  const deleteOrg = api.admin.deleteOrganization.useMutation({
    onSuccess: () => {
      utils.admin.getOrganizations.invalidate()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to delete organization',
        description: error.message,
      })
    },
  })

  /**
   * Handle search input change with debounce
   */
  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(0) // Reset to first page on search
    setSelectedIds(new Set()) // Clear selection on search
  }

  /**
   * Toggle selection of an organization
   */
  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  /**
   * Toggle select all on current page
   */
  const toggleSelectAll = () => {
    if (!data) return

    const currentPageIds = data.map((org) => org.id)
    const allSelected = currentPageIds.every((id) => selectedIds.has(id))

    setSelectedIds((prev) => {
      const newSet = new Set(prev)
      if (allSelected) {
        // Deselect all on current page
        currentPageIds.forEach((id) => newSet.delete(id))
      } else {
        // Select all on current page
        currentPageIds.forEach((id) => newSet.add(id))
      }
      return newSet
    })
  }

  /**
   * Handle bulk delete
   */
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return

    const confirmed = await confirm({
      title: `Delete ${selectedIds.size} organization${selectedIds.size > 1 ? 's' : ''}?`,
      description: `Are you sure you want to delete ${selectedIds.size} organization${selectedIds.size > 1 ? 's' : ''}? This action cannot be undone and will delete all associated data.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (!confirmed) return

    // Loop through selected organizations and delete them one by one
    const idsToDelete = Array.from(selectedIds)
    let successCount = 0
    let errorCount = 0

    for (const id of idsToDelete) {
      try {
        await deleteOrg.mutateAsync({ id })
        successCount++
      } catch (error) {
        errorCount++
      }
    }

    // Clear selection after deletion
    setSelectedIds(new Set())

    // Show summary toast if there were any errors
    if (errorCount > 0) {
      toastError({
        title: 'Some deletions failed',
        description: `Successfully deleted ${successCount} organization${successCount !== 1 ? 's' : ''}, but ${errorCount} failed.`,
      })
    }
  }

  /**
   * Navigate to organization details
   */
  const handleRowClick = (id: string) => {
    router.push(`/admin/organizations/${id}`)
  }

  /**
   * Format organization ID to show last 4 characters
   */
  const formatId = (id: string) => {
    return id.slice(-4)
  }

  const hasMore = data && data.length === PAGE_SIZE
  const allCurrentPageSelected =
    data && data.length > 0 && data.every((org) => selectedIds.has(org.id))

  return (
    <>
      <ConfirmDialog />
      <MainPage>
        <MainPageHeader
          action={
            <div className='flex items-center gap-2'>
              {demoStats && demoStats.activeDemoCount > 0 && (
                <Badge variant='secondary'>
                  {demoStats.activeDemoCount} active {pluralize(demoStats.activeDemoCount, 'demo')}
                </Badge>
              )}
              <Button
                variant='outline'
                size='sm'
                onClick={handleRunMigrations}
                loading={runMigrations.isPending}
                loadingText='Running...'>
                <Database />
                Run Entity Migrations
              </Button>
            </div>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Organizations' href='/admin/organizations' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <Card className='flex-1 flex flex-col overflow-y-auto'>
            <CardHeader>
              <CardTitle>Organizations</CardTitle>
              <CardDescription>Manage and view all organizations in the system</CardDescription>
            </CardHeader>
            <CardContent className='flex-1 flex flex-col gap-4'>
              {/* Search and Bulk Actions */}
              <div className='flex items-center gap-2'>
                <div className='relative flex-1 max-w-sm'>
                  <Search className='absolute left-2 top-2.5 h-4 w-4 text-muted-foreground' />
                  <Input
                    placeholder='Search by name or handle...'
                    value={search}
                    onChange={(e) => handleSearch(e.target.value)}
                    className='pl-8'
                  />
                </div>
                {selectedIds.size > 0 && (
                  <Button
                    variant='destructive'
                    size='sm'
                    onClick={handleBulkDelete}
                    loading={deleteOrg.isPending}>
                    <Trash2 />
                    Delete {selectedIds.size} selected
                  </Button>
                )}
              </div>

              {/* Table */}
              <div className='flex-1 border rounded-md overflow-auto'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className='w-12'>
                        <Checkbox
                          checked={allCurrentPageSelected}
                          onCheckedChange={toggleSelectAll}
                          aria-label='Select all'
                        />
                      </TableHead>
                      <TableHead>ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Handle</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Trialing</TableHead>
                      <TableHead>Trial Days Left</TableHead>
                      <TableHead className='text-right'>Users</TableHead>
                      <TableHead className='text-right'>Messages</TableHead>
                      <TableHead className='text-right'>Usage</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      // Loading skeleton
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Skeleton className='h-4 w-4' />
                          </TableCell>
                          <TableCell>
                            <Skeleton className='h-4 w-12' />
                          </TableCell>
                          <TableCell>
                            <Skeleton className='h-4 w-32' />
                          </TableCell>
                          <TableCell>
                            <Skeleton className='h-4 w-24' />
                          </TableCell>
                          <TableCell>
                            <Skeleton className='h-4 w-40' />
                          </TableCell>
                          <TableCell>
                            <Skeleton className='h-4 w-16' />
                          </TableCell>
                          <TableCell>
                            <Skeleton className='h-4 w-20' />
                          </TableCell>
                          <TableCell>
                            <Skeleton className='h-4 w-12' />
                          </TableCell>
                          <TableCell>
                            <Skeleton className='h-4 w-12' />
                          </TableCell>
                          <TableCell>
                            <Skeleton className='h-4 w-8 ml-auto' />
                          </TableCell>
                          <TableCell>
                            <Skeleton className='h-4 w-12 ml-auto' />
                          </TableCell>
                          <TableCell>
                            <Skeleton className='h-5 w-10 ml-auto' />
                          </TableCell>
                          <TableCell>
                            <Skeleton className='h-4 w-24' />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : data && data.length > 0 ? (
                      data.map((org) => (
                        <TableRow key={org.id} className='hover:bg-muted/50'>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedIds.has(org.id)}
                              onCheckedChange={() => toggleSelection(org.id)}
                              aria-label={`Select ${org.name}`}
                            />
                          </TableCell>
                          <TableCell
                            className='font-mono text-xs text-muted-foreground cursor-pointer'
                            onClick={() => handleRowClick(org.id)}>
                            ...{formatId(org.id)}
                          </TableCell>
                          <TableCell
                            className='font-medium cursor-pointer'
                            onClick={() => handleRowClick(org.id)}>
                            {org.name || '-'}
                          </TableCell>
                          <TableCell
                            className='text-muted-foreground cursor-pointer'
                            onClick={() => handleRowClick(org.id)}>
                            {org.handle || '-'}
                          </TableCell>
                          <TableCell
                            className='text-sm text-muted-foreground cursor-pointer'
                            onClick={() => handleRowClick(org.id)}>
                            {org.ownerEmail || '-'}
                          </TableCell>
                          <TableCell
                            className='text-xs uppercase text-muted-foreground cursor-pointer'
                            onClick={() => handleRowClick(org.id)}>
                            {org.type}
                          </TableCell>
                          <TableCell
                            className='cursor-pointer'
                            onClick={() => handleRowClick(org.id)}>
                            <span className='text-sm'>{org.plan || '-'}</span>
                          </TableCell>
                          <TableCell
                            className='cursor-pointer'
                            onClick={() => handleRowClick(org.id)}>
                            {org.isTrialing ? (
                              <span className='text-sm text-blue-600'>Yes</span>
                            ) : (
                              <span className='text-sm text-muted-foreground'>No</span>
                            )}
                          </TableCell>
                          <TableCell
                            className='cursor-pointer'
                            onClick={() => handleRowClick(org.id)}>
                            {org.trialDaysLeft !== null ? (
                              <span className='text-sm'>{org.trialDaysLeft} days</span>
                            ) : (
                              <span className='text-sm text-muted-foreground'>-</span>
                            )}
                          </TableCell>
                          <TableCell
                            className='text-right cursor-pointer'
                            onClick={() => handleRowClick(org.id)}>
                            {org.userCount}
                          </TableCell>
                          <TableCell
                            className='text-right cursor-pointer'
                            onClick={() => handleRowClick(org.id)}>
                            {org.messageCount}
                          </TableCell>
                          <TableCell
                            className='text-right cursor-pointer'
                            onClick={() => handleRowClick(org.id)}>
                            <UsageBadge summary={usageMap?.get(org.id)} />
                          </TableCell>
                          <TableCell
                            className='text-sm text-muted-foreground cursor-pointer'
                            onClick={() => handleRowClick(org.id)}>
                            {formatDistanceToNow(org.createdAt, { addSuffix: true })}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={13} className='text-center text-muted-foreground py-8'>
                          {search
                            ? 'No organizations found matching your search'
                            : 'No organizations'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className='flex items-center justify-between'>
                <div className='text-sm text-muted-foreground'>
                  {data && data.length > 0 ? (
                    <>
                      Showing {page * PAGE_SIZE + 1} to {page * PAGE_SIZE + data.length}
                    </>
                  ) : (
                    'No results'
                  )}
                </div>
                <div className='flex items-center gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0 || isLoading}>
                    <ChevronLeft className='h-4 w-4' />
                    Previous
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!hasMore || isLoading}>
                    Next
                    <ChevronRight className='h-4 w-4' />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </MainPageContent>
      </MainPage>
    </>
  )
}

/**
 * Compact usage badge showing the highest usage percentage across metrics
 */
function UsageBadge({ summary }: { summary?: { maxPercentUsed: number; allUnlimited: boolean } }) {
  if (!summary) return <Skeleton className='h-5 w-10 ml-auto' />
  if (summary.allUnlimited) return <Badge variant='outline'>&#8734;</Badge>

  const pct = Math.round(summary.maxPercentUsed)
  const variant = pct >= 90 ? 'destructive' : pct >= 70 ? 'secondary' : 'outline'
  return <Badge variant={variant}>{pct}%</Badge>
}
