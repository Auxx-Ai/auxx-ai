'use client'
// apps/web/src/app/(protected)/app/settings/import-history/_components/import-history-list.tsx

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '~/trpc/react'
import { Button } from '@auxx/ui/components/button'
import { Badge } from '@auxx/ui/components/badge'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { InputSearch } from '@auxx/ui/components/input-search'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@auxx/ui/components/empty'
import { MoreVertical, Columns, Rows3, Import } from 'lucide-react'
import { EntityIcon } from '@auxx/ui/components/icons'
import { useAllResources } from '~/components/resources'
import { formatRelativeTime } from '@auxx/utils/date'

/** Returns base path for a given target table */
function getBasePath(targetTable: string): string {
  if (targetTable === 'contact') return '/app/contacts'
  if (targetTable === 'ticket') return '/app/tickets'
  if (targetTable.startsWith('entity_')) {
    const slug = targetTable.replace('entity_', '')
    return `/app/custom/${slug}`
  }
  return '/app'
}

/** Status badge variant mapping */
function getStatusBadgeVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default'
    case 'failed':
    case 'canceled':
      return 'destructive'
    case 'executing':
      return 'secondary'
    default:
      return 'outline'
  }
}

interface ImportHistoryListProps {
  onDeleteJob: (jobId: string) => void
}

/**
 * Import history list component.
 * Displays all import jobs with search functionality.
 */
export function ImportHistoryList({ onDeleteJob }: ImportHistoryListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const router = useRouter()

  // Get all resources for resolving target table to display info
  const { getResourceById, isLoading: isLoadingResources } = useAllResources()

  const { data: jobs, isLoading: isLoadingJobs } = api.dataImport.listJobs.useQuery({
    search: searchQuery || undefined,
  })

  const isLoading = isLoadingResources || isLoadingJobs

  /** Navigate to the appropriate import page based on job status */
  const handleJobClick = (job: NonNullable<typeof jobs>[number]) => {
    const basePath = getBasePath(job.importMapping.targetTable)

    // Navigate to the import job page (wizard determines correct step from status)
    router.push(`${basePath}/import/${job.id}`)
  }

  /** Get display info for a target table from resource context */
  const getResourceDisplay = (targetTable: string) => {
    const resource = getResourceById(targetTable)
    if (resource) {
      return {
        icon: resource.icon,
        label: resource.plural,
      }
    }
    // Fallback for unknown resources
    return { icon: 'file', label: targetTable }
  }

  return (
    <div className="space-y-4 p-6 flex flex-col flex-1">
      {/* Search bar */}
      <div className="flex items-center">
        <div className="relative flex-1">
          <InputSearch
            placeholder="Search imports..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* List */}
      <div className=" flex-1 flex-col flex">
        {isLoading ? (
          <div className="space-y-3">
            {
              // Loading skeletons
              Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-2xl border py-2 px-3">
                  <div className="flex flex-row items-center gap-3">
                    <Skeleton className="size-8 rounded-lg shrink-0" />
                    <div className="flex flex-col gap-1">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-56" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-7 w-7 rounded" />
                  </div>
                </div>
              ))
            }
          </div>
        ) : !jobs || jobs.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center justify-center flex-1">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Import />
                </EmptyMedia>
                <EmptyTitle>No imports found</EmptyTitle>
                <EmptyDescription>
                  {searchQuery
                    ? 'Try adjusting your search terms'
                    : 'Import data from the Contacts, Tickets, or Custom Entities pages'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <div className="space-y-3 flex flex-col">
            {
              // Import job cards
              jobs.map((job) => {
                const resourceDisplay = getResourceDisplay(job.importMapping.targetTable)
                const createdByName = job.createdBy?.name || job.createdBy?.email || 'Unknown'

                return (
                  <div
                    key={job.id}
                    className="group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200 cursor-pointer"
                    onClick={() => handleJobClick(job)}>
                    {/* Left side: Icon + Info */}
                    <div className="flex flex-row items-center gap-3">
                      <EntityIcon iconId={resourceDisplay.icon} variant="muted" />

                      <div className="flex flex-col">
                        {/* Title: Filename + Entity badge */}
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{job.sourceFileName}</span>
                          <Badge variant="outline" className="text-xs">
                            {resourceDisplay.label}
                          </Badge>
                        </div>

                        {/* Subtitle: Created by + date | columns | rows */}
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>
                            Created by {createdByName} {formatRelativeTime(job.createdAt)}
                          </span>
                          <span className="text-muted-foreground/50">|</span>
                          <span className="flex items-center gap-1">
                            <Columns className="size-3" />
                            {job.columnCount}
                          </span>
                          <span className="flex items-center gap-1">
                            <Rows3 className="size-3" />
                            {job.rowCount}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right side: Status + Actions */}
                    <div className="flex items-center gap-2">
                      <Badge variant={getStatusBadgeVariant(job.status)}>{job.status}</Badge>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon-sm">
                            <MoreVertical />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation()
                              onDeleteJob(job.id)
                            }}>
                            Delete Import
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )
              })
            }
          </div>
        )}
      </div>
    </div>
  )
}
