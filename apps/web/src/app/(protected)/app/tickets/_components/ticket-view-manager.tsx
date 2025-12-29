'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@auxx/ui/components/dialog'
import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Checkbox } from '@auxx/ui/components/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@auxx/ui/components/dropdown-menu'
import {
  BookmarkIcon,
  TrashIcon,
  ChevronDownIcon,
  LockIcon,
  GlobeIcon,
  UserIcon,
} from 'lucide-react'
import { api } from '~/trpc/react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'

type FilterState = {
  status: string[]
  type: string[]
  priority: string[]
  assigneeIds: string[]
  searchQuery: string
}

type TicketViewManagerProps = { currentFilters: FilterState; onLoadView: (view: any) => void }

export function TicketViewManager({ currentFilters, onLoadView }: TicketViewManagerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [viewName, setViewName] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const router = useRouter()

  // Fetch saved views
  const { data: views, refetch } = api.ticketView.list.useQuery()

  // Create a new view
  const createView = api.ticketView.create.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'View saved',
        description: `"${viewName}" has been saved successfully.`,
      })
      setViewName('')
      setIsPublic(false)
      setIsOpen(false)
      refetch()
    },
    onError: (error) => {
      toastError({ title: 'Error saving view', description: error.message })
    },
  })

  // Delete a view
  const deleteView = api.ticketView.delete.useMutation({
    onSuccess: () => {
      toastSuccess({
        title: 'View deleted',
        description: 'The view has been deleted successfully.',
      })
      refetch()
    },
  })

  // Toggle public status
  const togglePublic = api.ticketView.togglePublic.useMutation({
    onSuccess: (data) => {
      toastSuccess({
        title: data.isPublic ? 'View shared' : 'View made private',
        description: data.isPublic
          ? `"${data.name}" is now visible to your team.`
          : `"${data.name}" is now private.`,
      })
      refetch()
    },
  })

  const handleSaveView = async () => {
    if (!viewName.trim()) return

    await createView.mutateAsync({
      name: viewName,
      isPublic,
      filters: {
        status: currentFilters.status,
        type: currentFilters.type,
        priority: currentFilters.priority,
        assigneeIds: currentFilters.assigneeIds,
        searchQuery: currentFilters.searchQuery,
      },
    })
  }

  const handleLoadView = (view: any) => {
    onLoadView(view)
    toastSuccess({ title: 'View loaded', description: `"${view.name}" has been loaded.` })
  }

  const handleDeleteView = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    deleteView.mutate({ id })
  }

  const handleTogglePublic = (id: string, isCurrentlyPublic: boolean, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    togglePublic.mutate({ id, isPublic: !isCurrentlyPublic })
  }

  // Check if current user is the owner of a view
  const isOwner = (view: any) => {
    return true
    // return view.userId === session?.user.id
  }

  // Display a summary of the current filter state
  const getFilterSummary = () => {
    const parts = []

    if (currentFilters.status.length > 0) {
      parts.push(
        `${currentFilters.status.length} status${currentFilters.status.length > 1 ? 'es' : ''}`
      )
    }

    if (currentFilters.type.length > 0) {
      parts.push(`${currentFilters.type.length} type${currentFilters.type.length > 1 ? 's' : ''}`)
    }

    if (currentFilters.priority.length > 0) {
      parts.push(
        `${currentFilters.priority.length} priorit${currentFilters.priority.length > 1 ? 'ies' : 'y'}`
      )
    }

    if (currentFilters.assigneeIds.length > 0) {
      parts.push(
        `${currentFilters.assigneeIds.length} assignee${currentFilters.assigneeIds.length > 1 ? 's' : ''}`
      )
    }

    if (currentFilters.searchQuery) {
      parts.push('search query')
    }

    if (parts.length === 0) {
      return 'No active filters'
    }

    return parts.join(', ')
  }

  // Group views into my views and team views
  const myViews = views?.filter((view) => isOwner(view)) || []
  const teamViews = views?.filter((view) => !isOwner(view)) || []

  return (
    <div>
      <div className="flex items-center gap-2">
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <BookmarkIcon className="mr-2 h-4 w-4" />
              Save View
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save Current View</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="mb-2 block text-sm font-medium">View Name</label>
                <Input
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                  placeholder="My Custom View"
                />
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="isPublic"
                  checked={isPublic}
                  onCheckedChange={(checked) => setIsPublic(checked === true)}
                />
                <label
                  htmlFor="isPublic"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  Share with team
                </label>
              </div>

              <div className="text-sm text-muted-foreground">
                <p>Current filters: {getFilterSummary()}</p>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="outline"
                onClick={handleSaveView}
                disabled={!viewName.trim() || createView.isPending}
                loading={createView.isPending}
                loadingText="Saving...">
                Save View
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Views
              <ChevronDownIcon className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {!views || (myViews.length === 0 && teamViews.length === 0) ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">No saved views</div>
            ) : (
              <>
                {myViews.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      My Views
                    </div>
                    {myViews.map((view) => (
                      <DropdownMenuItem
                        key={view.id}
                        onClick={() => handleLoadView(view)}
                        className="group flex items-center justify-between">
                        <div className="flex items-center">
                          {view.isPublic ? (
                            <GlobeIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                          ) : (
                            <LockIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="truncate">{view.name}</span>
                        </div>
                        <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={(e) => handleTogglePublic(view.id, view.isPublic, e)}
                            className="mr-1 rounded-sm p-1 hover:bg-accent"
                            title={view.isPublic ? 'Make private' : 'Share with team'}>
                            {view.isPublic ? (
                              <LockIcon className="h-3.5 w-3.5" />
                            ) : (
                              <GlobeIcon className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            onClick={(e) => handleDeleteView(view.id, e)}
                            className="rounded-sm p-1 hover:bg-accent"
                            title="Delete view">
                            <TrashIcon className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}

                {teamViews.length > 0 && (
                  <>
                    {myViews.length > 0 && <DropdownMenuSeparator />}
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      Team Views
                    </div>
                    {teamViews.map((view) => (
                      <DropdownMenuItem key={view.id} onClick={() => handleLoadView(view)}>
                        <div className="flex items-center">
                          <UserIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                          <span className="truncate">{view.name}</span>
                          {view.user?.name && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              by {view.user.name}
                            </span>
                          )}
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
