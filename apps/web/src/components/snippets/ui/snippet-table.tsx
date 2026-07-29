// apps/web/src/components/snippets/ui/snippet-table.tsx
'use client'

import { toActorId } from '@auxx/types/actor'
import { toRecordId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { InputSearch } from '@auxx/ui/components/input-search'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { cn } from '@auxx/ui/lib/utils'
import { keepPreviousData } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  CopyIcon,
  Edit2Icon,
  EyeIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PanelLeft,
  Share2,
  StarIcon,
  Tag,
  Trash2Icon,
  UserIcon,
  UsersIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { FavoriteToggleMenuItem } from '~/components/favorites/ui/favorite-toggle-menu-item'
import { EmptyState } from '~/components/global/empty-state'
import { InstanceShareDialog } from '~/components/permissions/ui/instance-share-dialog'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'
import { useSnippetContext } from '../hooks/snippet-context'
import type { Snippet } from '../hooks/snippet-types'
import { useSnippetAccess } from '../hooks/use-snippet-access'

// Format relative time
const formatRelativeTime = (date: Date) => {
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

interface SnippetTableProps {
  onEdit: (snippet: Snippet) => void
  onCopy: (snippet: Snippet) => void
}

export function SnippetTable({ onEdit, onCopy }: SnippetTableProps) {
  // Use snippet context
  const {
    selectedFolderId,
    searchTerm,
    setSearchTerm,
    currentFolderName,
    deleteSnippet,
    updateSnippet,
    toggleFolderPanel,
  } = useSnippetContext()
  // Use confirm hook for delete confirmation
  const [confirm, ConfirmDialog] = useConfirm()
  // Local state for debounced search
  const [localSearchTerm, setLocalSearchTerm] = useState(searchTerm)
  // Update local search term when prop changes
  useEffect(() => {
    setLocalSearchTerm(searchTerm)
  }, [searchTerm])
  // Debounce search term updates
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearchTerm !== searchTerm) {
        setSearchTerm(localSearchTerm)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [localSearchTerm, setSearchTerm, searchTerm])
  // Fetch snippets. `includeShared: true` is the whole VISIBLE set — the server
  // narrows it to what this member may `view` in SQL before the read, so there
  // is nothing left to filter here. `false` would narrow to snippets I created.
  const { data, isLoading } = api.snippet.all.useQuery(
    {
      folderId: selectedFolderId || undefined,
      searchQuery: searchTerm || undefined,
      includeShared: true,
    },
    { placeholderData: keepPreviousData, refetchOnWindowFocus: false }
  )
  // Handle delete
  const handleDeleteSnippet = async (snippet: Snippet) => {
    const confirmed = await confirm({
      title: 'Delete Snippet',
      description: `Are you sure you want to delete "${snippet.title}"? This action cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
    })
    if (confirmed) {
      try {
        await deleteSnippet(snippet.id)
      } catch (_error) {
        // Error handling is done in the context
      }
    }
  }
  // Handle toggle favorite
  const handleToggleFavorite = async (snippet: Snippet) => {
    try {
      await updateSnippet(snippet.id, { isFavorite: !snippet.isFavorite })
    } catch (_error) {
      // Error handling is done in the context
    }
  }
  return (
    <div className='flex flex-1 flex-col overflow-hidden h-full w-full'>
      <div className='flex items-center justify-between border-b p-2'>
        <div className='flex flex-row  items-center gap-1'>
          <Button
            data-sidebar='trigger'
            variant='ghost'
            size='icon'
            className='size-7'
            onClick={toggleFolderPanel}>
            <PanelLeft />
            <span className='sr-only'>Toggle Sidebar</span>
          </Button>
          <span className='text-sm'>{currentFolderName || 'All Snippets'}</span>
        </div>
        <div className='w-64'>
          <InputSearch
            placeholder='Search snippets...'
            value={localSearchTerm}
            onChange={(e) => setLocalSearchTerm(e.target.value)}
            onClear={() => {
              setLocalSearchTerm('')
              setSearchTerm('')
            }}
          />
        </div>
      </div>

      <div className='flex-1 overflow-auto h-full flex flex-col'>
        {isLoading ? (
          <EmptyState
            icon={Tag}
            iconClassName='animate-spin'
            title='Loading snippets...'
            description={<>Hang on tight while we load your snippets...</>}
            button={<div className='h-12'></div>}
          />
        ) : data?.snippets.length === 0 ? (
          <EmptyState
            icon={Tag}
            title={
              searchTerm
                ? 'No Snippets Found'
                : selectedFolderId
                  ? 'Folder is Empty'
                  : 'No Snippets Yet'
            }
            description={
              searchTerm
                ? `No snippets match "${searchTerm}"`
                : selectedFolderId
                  ? 'This folder has no snippets. Create one or move existing snippets here.'
                  : 'Create your first snippet to get started.'
            }
            button={
              searchTerm ? (
                <Button variant='outline' onClick={() => setSearchTerm('')}>
                  Clear search
                </Button>
              ) : null
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-12'></TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Folder</TableHead>
                <TableHead>Sharing</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className='w-12'></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.snippets.map((snippet) => (
                <SnippetRow
                  key={snippet.id}
                  snippet={snippet}
                  onEdit={onEdit}
                  onCopy={onCopy}
                  onDelete={handleDeleteSnippet}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <ConfirmDialog />
    </div>
  )
}

/**
 * One snippet row.
 *
 * Split out of the table body so each row can resolve its OWN per-instance
 * access — {@link useSnippetAccess} is a hook and cannot be called inside a
 * `.map()` callback. Every row here is at least viewable (`snippet.all` already
 * filtered to the visible set), so the row gates only the write affordances:
 * favourite at `edit`, Share… and Delete at `admin`, Duplicate at
 * `snippets.manage` (it creates a new snippet).
 */
function SnippetRow({
  snippet,
  onEdit,
  onCopy,
  onDelete,
  onToggleFavorite,
}: {
  snippet: Snippet
  onEdit: (snippet: Snippet) => void
  onCopy: (snippet: Snippet) => void
  onDelete: (snippet: Snippet) => void
  onToggleFavorite: (snippet: Snippet) => void
}) {
  const { canEdit, canAdmin, canManage } = useSnippetAccess(snippet.id)
  const [shareOpen, setShareOpen] = useState(false)

  // Grants to OTHERS, counted server-side — the owner's own `admin` row is
  // excluded there, so `0` really means "nobody else can see this".
  const shareCount = snippet._count.shares

  return (
    <>
      {canAdmin && (
        <InstanceShareDialog
          recordId={toRecordId('snippet', snippet.id)}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
      <TableRow>
        <TableCell className='p-2'>
          <Button
            variant='ghost'
            size='icon'
            disabled={!canEdit}
            onClick={() => onToggleFavorite(snippet)}
            className='h-8 w-8'>
            <StarIcon
              size={16}
              className={cn(
                'transition-colors',
                snippet.isFavorite
                  ? 'fill-yellow-400 text-yellow-400'
                  : 'text-gray-300 hover:text-gray-400'
              )}
            />
          </Button>
        </TableCell>
        <TableCell className='font-medium'>
          <div className='flex flex-col items-start'>
            <Button
              variant='link'
              size='sm'
              className='h-auto p-0 font-medium'
              onClick={() => onEdit(snippet)}>
              {snippet.title}
            </Button>
            {snippet.description && (
              <span className='max-w-md truncate text-xs text-gray-500'>{snippet.description}</span>
            )}
          </div>
        </TableCell>
        <TableCell>
          {snippet.folder ? (
            <div className='flex items-center'>
              <FolderIcon size={14} className='mr-1 text-gray-500' />
              <span>{snippet.folder.name}</span>
            </div>
          ) : (
            <span className='text-gray-500'>—</span>
          )}
        </TableCell>
        <TableCell>
          <div className='w-fit'>
            {shareCount === 0 ? (
              <Badge variant='gray'>
                <UserIcon />
                Private
              </Badge>
            ) : (
              <Badge variant='blue'>
                <UsersIcon />
                Shared with {shareCount}
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell>
          <div className='w-fit'>
            <ActorBadge actorId={toActorId('user', snippet.createdBy.id)} showIcon />
          </div>
        </TableCell>
        <TableCell className='text-sm text-gray-500'>
          {formatRelativeTime(snippet.updatedAt)}
        </TableCell>
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon-sm'>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={() => onEdit(snippet)}>
                {canEdit ? <Edit2Icon /> : <EyeIcon />}
                {canEdit ? 'Edit' : 'Open'}
              </DropdownMenuItem>
              {canAdmin && (
                <DropdownMenuItem onClick={() => setShareOpen(true)}>
                  <Share2 />
                  Share…
                </DropdownMenuItem>
              )}
              {canManage && (
                <DropdownMenuItem onClick={() => onCopy(snippet)}>
                  <CopyIcon />
                  Duplicate
                </DropdownMenuItem>
              )}
              <FavoriteToggleMenuItem targetType='SNIPPET' targetIds={{ snippetId: snippet.id }} />
              {canAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onDelete(snippet)} variant='destructive'>
                    <Trash2Icon />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    </>
  )
}
