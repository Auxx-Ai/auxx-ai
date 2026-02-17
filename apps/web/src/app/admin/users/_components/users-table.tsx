// apps/web/src/app/admin/users/_components/users-table.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Input } from '@auxx/ui/components/input'
import { MainPageSubheader } from '@auxx/ui/components/main-page'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
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
import { formatDistanceToNow } from 'date-fns'
import { ChevronLeft, ChevronRight, Search, Trash2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

const DEFAULT_PAGE_SIZE = 100

/** Props for the UsersTable component */
interface UsersTableProps {
  /** Pre-lock to a specific org — hides the org filter dropdown */
  organizationId?: string
  /** Page size override (default 100) */
  pageSize?: number
}

/**
 * Reusable users table with search, pagination, bulk selection, and delete.
 * When organizationId is passed, the org filter is locked and hidden.
 */
export function UsersTable({ organizationId, pageSize = DEFAULT_PAGE_SIZE }: UsersTableProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedOrgId, setSelectedOrgId] = useState<string | undefined>(organizationId)

  const isOrgLocked = organizationId !== undefined

  const { data: users, isLoading } = api.admin.getUsers.useQuery({
    limit: pageSize,
    offset: page * pageSize,
    search: search || undefined,
    organizationId: isOrgLocked ? organizationId : selectedOrgId,
  })

  const { data: organizations } = api.admin.getOrganizations.useQuery(
    { limit: 100, offset: 0 },
    { enabled: !isOrgLocked }
  )

  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const deleteUser = api.admin.deleteUser.useMutation({
    onSuccess: () => {
      utils.admin.getUsers.invalidate()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to delete user',
        description: error.message,
      })
    },
  })

  /** Handle search input change */
  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(0)
    setSelectedIds(new Set())
  }

  /** Handle organization filter change */
  const handleOrgFilter = (orgId: string) => {
    setSelectedOrgId(orgId)
    setPage(0)
    setSelectedIds(new Set())
  }

  /** Clear organization filter */
  const clearOrgFilter = () => {
    setSelectedOrgId(undefined)
    setPage(0)
    setSelectedIds(new Set())
  }

  /** Toggle selection of a user */
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

  /** Toggle select all on current page */
  const toggleSelectAll = () => {
    if (!users) return

    const currentPageIds = users.map((user) => user.id)
    const allSelected = currentPageIds.every((id) => selectedIds.has(id))

    setSelectedIds((prev) => {
      const newSet = new Set(prev)
      if (allSelected) {
        currentPageIds.forEach((id) => newSet.delete(id))
      } else {
        currentPageIds.forEach((id) => newSet.add(id))
      }
      return newSet
    })
  }

  /** Handle bulk delete */
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return

    const confirmed = await confirm({
      title: `Delete ${selectedIds.size} user${selectedIds.size > 1 ? 's' : ''}?`,
      description: `Are you sure you want to delete ${selectedIds.size} user${selectedIds.size > 1 ? 's' : ''}? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (!confirmed) return

    const idsToDelete = Array.from(selectedIds)
    let successCount = 0
    let errorCount = 0

    for (const id of idsToDelete) {
      try {
        await deleteUser.mutateAsync({ id })
        successCount++
      } catch (error) {
        errorCount++
      }
    }

    setSelectedIds(new Set())

    if (errorCount > 0) {
      toastError({
        title: 'Some deletions failed',
        description: `Successfully deleted ${successCount} user${successCount !== 1 ? 's' : ''}, but ${errorCount} failed.`,
      })
    }
  }

  /** Navigate to user details */
  const handleRowClick = (id: string) => {
    router.push(`/admin/users/${id}`)
  }

  /** Format user ID to show last 4 characters */
  const formatId = (id: string) => {
    return id.slice(-4)
  }

  /** Get display name for user */
  const getDisplayName = (user: {
    name: string | null
    firstName: string | null
    lastName: string | null
  }) => {
    if (user.name) return user.name
    if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`
    if (user.firstName) return user.firstName
    if (user.lastName) return user.lastName
    return '-'
  }

  const selectedOrg = organizations?.find((org) => org.id === selectedOrgId)
  const hasMore = users && users.length === pageSize
  const allCurrentPageSelected =
    users && users.length > 0 && users.every((user) => selectedIds.has(user.id))

  return (
    <>
      <ConfirmDialog />

      {/* Filters and Bulk Actions */}
      <MainPageSubheader>
        {/* Organization Filter — hidden when org is locked */}
        {!isOrgLocked && (
          <>
            <Select value={selectedOrgId} onValueChange={handleOrgFilter}>
              <SelectTrigger className='w-[250px]' size='sm'>
                <SelectValue placeholder='All Organizations' />
              </SelectTrigger>
              <SelectContent>
                {organizations?.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name || org.handle || 'Unnamed'} ({org.userCount} users)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedOrgId && (
              <Button variant='ghost' size='sm' onClick={clearOrgFilter}>
                <X />
                Clear filter
              </Button>
            )}
          </>
        )}

        {/* Search */}
        <div className='relative flex-1 max-w-sm'>
          <Search className='absolute left-2 top-1.5 h-4 w-4 text-muted-foreground' />
          <Input
            placeholder='Search by name or email...'
            value={search}
            size='sm'
            onChange={(e) => handleSearch(e.target.value)}
            className='pl-8'
          />
        </div>

        {/* Bulk Delete */}
        {selectedIds.size > 0 && (
          <Button
            variant='destructive'
            size='sm'
            onClick={handleBulkDelete}
            loading={deleteUser.isPending}>
            <Trash2 />
            Delete {selectedIds.size} selected
          </Button>
        )}
      </MainPageSubheader>

      {/* Active Filter Badge — hidden when org is locked */}
      {!isOrgLocked && selectedOrgId && selectedOrg && (
        <div className='flex items-center gap-2'>
          <span className='text-sm text-muted-foreground'>Filtering by:</span>
          <Badge variant='secondary'>{selectedOrg.name || selectedOrg.handle || 'Unnamed'}</Badge>
        </div>
      )}

      {/* Table */}
      <div className='flex-1 overflow-hidden flex flex-col min-h-0 relative'>
        <div className='overflow-auto flex-1 relative'>
          <Table>
            <TableHeader className='sticky top-0 bg-background z-10'>
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
                <TableHead>Email</TableHead>
                <TableHead className='text-right'>Organizations</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
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
                      <Skeleton className='h-4 w-40' />
                    </TableCell>
                    <TableCell>
                      <Skeleton className='h-4 w-8 ml-auto' />
                    </TableCell>
                    <TableCell>
                      <Skeleton className='h-4 w-16' />
                    </TableCell>
                    <TableCell>
                      <Skeleton className='h-4 w-24' />
                    </TableCell>
                  </TableRow>
                ))
              ) : users && users.length > 0 ? (
                users.map((user) => (
                  <TableRow key={user.id} className='hover:bg-muted/50'>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(user.id)}
                        onCheckedChange={() => toggleSelection(user.id)}
                        aria-label={`Select ${user.email}`}
                      />
                    </TableCell>
                    <TableCell
                      className='font-mono text-xs text-muted-foreground cursor-pointer'
                      onClick={() => handleRowClick(user.id)}>
                      ...{formatId(user.id)}
                    </TableCell>
                    <TableCell
                      className='font-medium cursor-pointer'
                      onClick={() => handleRowClick(user.id)}>
                      {getDisplayName(user)}
                    </TableCell>
                    <TableCell
                      className='text-muted-foreground cursor-pointer'
                      onClick={() => handleRowClick(user.id)}>
                      {user.email || '-'}
                    </TableCell>
                    <TableCell
                      className='text-right cursor-pointer'
                      onClick={() => handleRowClick(user.id)}>
                      {user.organizationCount}
                    </TableCell>
                    <TableCell className='cursor-pointer' onClick={() => handleRowClick(user.id)}>
                      {user.emailVerified ? (
                        <Badge variant='outline' className='text-xs'>
                          Yes
                        </Badge>
                      ) : (
                        <span className='text-xs text-muted-foreground'>No</span>
                      )}
                    </TableCell>
                    <TableCell
                      className='text-sm text-muted-foreground cursor-pointer'
                      onClick={() => handleRowClick(user.id)}>
                      {formatDistanceToNow(user.createdAt, { addSuffix: true })}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className='text-center text-muted-foreground py-8'>
                    {search || selectedOrgId ? 'No users found matching your filters' : 'No users'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination */}
      <div className='flex items-center justify-between px-2 py-1 border-t'>
        <div className='text-sm text-muted-foreground'>
          {users && users.length > 0 ? (
            <>
              Showing {page * pageSize + 1} to {page * pageSize + users.length}
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
            <ChevronLeft />
            Previous
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore || isLoading}>
            Next
            <ChevronRight />
          </Button>
        </div>
      </div>
    </>
  )
}
