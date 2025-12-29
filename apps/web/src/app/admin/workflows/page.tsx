// apps/web/src/app/admin/workflows/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '~/trpc/react'
import { Input } from '@auxx/ui/components/input'
import { Button } from '@auxx/ui/components/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { Badge } from '@auxx/ui/components/badge'
import {
  Search,
  Plus,
  Eye,
  EyeOff,
  Copy,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { formatDistanceToNow } from 'date-fns'
import { useConfirm } from '~/hooks/use-confirm'
import { toastError } from '@auxx/ui/components/toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
  MainPageSubheader,
} from '@auxx/ui/components/main-page'

const PAGE_SIZE = 50

/**
 * Workflow templates list page for admin
 */
export default function WorkflowTemplatesPage() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'public' | 'private'>('all')
  const [page, setPage] = useState(0)

  const { data: templates, isLoading } = api.admin.workflowTemplates.getAll.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    search: search || undefined,
    status: statusFilter,
  })

  const [confirm, ConfirmDialog] = useConfirm()
  const utils = api.useUtils()

  const deleteTemplate = api.admin.workflowTemplates.delete.useMutation({
    onSuccess: () => {
      utils.admin.workflowTemplates.getAll.invalidate()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to delete template',
        description: error.message,
      })
    },
  })

  const updateTemplate = api.admin.workflowTemplates.update.useMutation({
    onSuccess: () => {
      utils.admin.workflowTemplates.getAll.invalidate()
    },
    onError: (error) => {
      toastError({
        title: 'Failed to update template',
        description: error.message,
      })
    },
  })

  const duplicateTemplate = api.admin.workflowTemplates.duplicate.useMutation({
    onSuccess: (data) => {
      utils.admin.workflowTemplates.getAll.invalidate()
      router.push(`/admin/workflows/${data.id}`)
    },
    onError: (error) => {
      toastError({
        title: 'Failed to duplicate template',
        description: error.message,
      })
    },
  })

  /**
   * Handle search input change
   */
  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(0)
  }

  /**
   * Handle status filter change
   */
  const handleStatusFilter = (value: 'all' | 'public' | 'private') => {
    setStatusFilter(value)
    setPage(0)
  }

  /**
   * Handle delete template
   */
  const handleDelete = async (id: string, name: string) => {
    const confirmed = await confirm({
      title: `Delete "${name}"?`,
      description: 'This action cannot be undone. The template will be permanently deleted.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      await deleteTemplate.mutateAsync({ id })
    }
  }

  /**
   * Handle toggle visibility
   */
  const handleToggleVisibility = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'public' ? 'private' : 'public'
    await updateTemplate.mutateAsync({ id, status: newStatus })
  }

  /**
   * Handle duplicate template
   */
  const handleDuplicate = async (id: string) => {
    await duplicateTemplate.mutateAsync({ id })
  }

  /**
   * Navigate to template editor
   */
  const handleRowClick = (id: string) => {
    router.push(`/admin/workflows/${id}`)
  }

  const hasMore = templates && templates.length === PAGE_SIZE

  return (
    <>
      <ConfirmDialog />
      <MainPage>
        <MainPageHeader
          action={
            <Button size="sm" onClick={() => router.push('/admin/workflows/new')}>
              <Plus />
              Create Template
            </Button>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title="Admin" href="/admin" />
            <MainPageBreadcrumbItem title="Workflow Templates" href="/admin/workflows" last />
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent>
          {/* Filters */}
          <MainPageSubheader>
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2 top-1.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search templates..."
                value={search}
                size="sm"
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={statusFilter} onValueChange={handleStatusFilter}>
              <SelectTrigger className="w-[150px]" size="sm">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="public">Public</SelectItem>
                <SelectItem value="private">Private</SelectItem>
              </SelectContent>
            </Select>
          </MainPageSubheader>

          {/* Table */}
          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Categories</TableHead>
                  <TableHead>Popularity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  // Loading skeleton
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-4 w-32" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-48" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-8" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-8 w-24 ml-auto" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : templates && templates.length > 0 ? (
                  templates.map((template) => (
                    <TableRow key={template.id} className="hover:bg-muted/50">
                      <TableCell
                        className="font-medium cursor-pointer"
                        onClick={() => handleRowClick(template.id)}>
                        {template.name}
                      </TableCell>
                      <TableCell
                        className="text-sm text-muted-foreground max-w-xs truncate cursor-pointer"
                        onClick={() => handleRowClick(template.id)}>
                        {template.description}
                      </TableCell>
                      <TableCell
                        className="cursor-pointer"
                        onClick={() => handleRowClick(template.id)}>
                        <div className="flex gap-1 flex-wrap">
                          {(template.categories as string[])?.slice(0, 2).map((cat) => (
                            <Badge key={cat} variant="outline" className="text-xs">
                              {cat}
                            </Badge>
                          ))}
                          {(template.categories as string[])?.length > 2 && (
                            <Badge variant="outline" className="text-xs">
                              +{(template.categories as string[]).length - 2}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell
                        className="cursor-pointer"
                        onClick={() => handleRowClick(template.id)}>
                        {template.popularity}
                      </TableCell>
                      <TableCell
                        className="cursor-pointer"
                        onClick={() => handleRowClick(template.id)}>
                        <Badge variant={template.status === 'public' ? 'default' : 'secondary'}>
                          {template.status}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="text-sm text-muted-foreground cursor-pointer"
                        onClick={() => handleRowClick(template.id)}>
                        {formatDistanceToNow(template.updatedAt, { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              handleToggleVisibility(template.id, template.status)
                            }
                            loading={updateTemplate.isPending}>
                            {template.status === 'public' ? <EyeOff /> : <Eye />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDuplicate(template.id)}
                            loading={duplicateTemplate.isPending}>
                            <Copy />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(template.id, template.name)}
                            loading={deleteTemplate.isPending}>
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      {search || statusFilter !== 'all'
                        ? 'No templates found matching your filters'
                        : 'No templates'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-2 py-1 border-t">
            <div className="text-sm text-muted-foreground">
              {templates && templates.length > 0 ? (
                <>
                  Showing {page * PAGE_SIZE + 1} to {page * PAGE_SIZE + templates.length}
                </>
              ) : (
                'No results'
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || isLoading}>
                <ChevronLeft />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasMore || isLoading}>
                Next
                <ChevronRight />
              </Button>
            </div>
          </div>
        </MainPageContent>
      </MainPage>
    </>
  )
}
