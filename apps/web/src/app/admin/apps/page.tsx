// apps/web/src/app/admin/apps/page.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
  MainPageSubheader,
} from '@auxx/ui/components/main-page'
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
import { formatDistanceToNow } from 'date-fns'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { api } from '~/trpc/react'

const PAGE_SIZE = 100

/**
 * Get badge variant for publication status
 */
function getStatusVariant(status: string): 'outline' | 'secondary' | 'default' | 'destructive' {
  switch (status) {
    case 'private':
      return 'outline'
    case 'review':
      return 'secondary'
    case 'published':
      return 'default'
    case 'rejected':
      return 'destructive'
    default:
      return 'outline'
  }
}

/**
 * Apps list page for admin
 */
export default function AppsPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [publicationStatus, setPublicationStatus] = useState<
    'published' | 'unpublished' | undefined
  >(undefined)

  const { data: apps, isLoading } = api.admin.apps.getApps.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    search: search || undefined,
    publicationStatus,
  })

  /**
   * Handle search input change
   */
  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(0)
  }

  /**
   * Handle publication status filter change
   */
  const handleStatusFilter = (status: string) => {
    if (status === 'all') {
      setPublicationStatus(undefined)
    } else {
      setPublicationStatus(status as 'published' | 'unpublished')
    }
    setPage(0)
  }

  /**
   * Handle row click - navigate to app detail
   */
  const handleRowClick = (appId: string) => {
    router.push(`/admin/apps/${appId}`)
  }

  return (
    <>
      <ConfirmDialog />
      <MainPage>
        <MainPageHeader>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Admin' href='/admin' />
            <MainPageBreadcrumbItem title='Apps' href='/admin/apps' last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          <MainPageSubheader>
            <div className='relative flex-1'>
              <Search className='absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
              <Input
                placeholder='Search by app name or slug...'
                value={search}
                size='sm'
                onChange={(e) => handleSearch(e.target.value)}
                className='pl-9'
              />
            </div>
            <Select value={publicationStatus || 'all'} onValueChange={handleStatusFilter}>
              <SelectTrigger className='w-[180px]' size='sm'>
                <SelectValue placeholder='All Statuses' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>All Statuses</SelectItem>
                <SelectItem value='private'>Private</SelectItem>
                <SelectItem value='review'>In Review</SelectItem>
                <SelectItem value='published'>Published</SelectItem>
                <SelectItem value='rejected'>Rejected</SelectItem>
              </SelectContent>
            </Select>
          </MainPageSubheader>

          {isLoading ? (
            <div className='flex-1 overflow-hidden flex flex-col min-h-0 relative'>
              <div className='overflow-auto flex-1 relative'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>App Name</TableHead>
                      <TableHead>Developer Account</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <div className='space-y-1'>
                            <Skeleton className='h-4 w-32' />
                            <Skeleton className='h-3 w-20' />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Skeleton className='h-4 w-28' />
                        </TableCell>
                        <TableCell>
                          <Skeleton className='h-4 w-12' />
                        </TableCell>
                        <TableCell>
                          <Skeleton className='h-5 w-16 rounded-full' />
                        </TableCell>
                        <TableCell>
                          <Skeleton className='h-4 w-20' />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : !apps || apps.length === 0 ? (
            <div className='flex h-40 items-center justify-center text-muted-foreground'>
              No apps found
            </div>
          ) : (
            <>
              <div className='flex-1 overflow-hidden flex flex-col min-h-0 relative'>
                <div className='overflow-auto flex-1 relative'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>App Name</TableHead>
                        <TableHead>Developer Account</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {apps.map((app) => (
                        <TableRow
                          key={app.id}
                          className='cursor-pointer'
                          onClick={() => handleRowClick(app.id)}>
                          <TableCell>
                            <div>
                              <div className='font-medium'>{app.title}</div>
                              <div className='text-sm text-muted-foreground'>@{app.slug}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {app.developerAccount ? (
                              <div>{app.developerAccount.title}</div>
                            ) : (
                              <span className='text-muted-foreground'>-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {app.latestDeployment?.version || (
                              <span className='text-muted-foreground'>-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={getStatusVariant(app.publicationStatus)}>
                              {app.publicationStatus}
                            </Badge>
                          </TableCell>
                          <TableCell className='text-muted-foreground'>
                            {formatDistanceToNow(new Date(app.createdAt), { addSuffix: true })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
              <div className='border-t py-1 px-2 flex items-center justify-between'>
                <div className='text-sm text-muted-foreground'>
                  Showing {page * PAGE_SIZE + 1} to{' '}
                  {Math.min((page + 1) * PAGE_SIZE, page * PAGE_SIZE + apps.length)} results
                </div>
                <div className='flex gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}>
                    <ChevronLeft />
                    Previous
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!apps || apps.length < PAGE_SIZE}>
                    Next
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            </>
          )}
        </MainPageContent>
      </MainPage>
    </>
  )
}

/**
 * Placeholder for ConfirmDialog - will be used in detail page
 */
function ConfirmDialog() {
  return null
}
