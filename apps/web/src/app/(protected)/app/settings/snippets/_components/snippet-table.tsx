// components/snippets/SnippetTable.tsx

import type { SnippetSharingType } from '@auxx/database/enums'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { Input } from '@auxx/ui/components/input'
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
  FolderIcon,
  MoreHorizontalIcon,
  PanelLeft,
  SearchIcon,
  StarIcon,
  Tag,
  Trash2Icon,
  UserIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { useConfirm } from '~/hooks/use-confirm'
import { useSnippetContext } from '~/hooks/use-snippet-context'
import { api } from '~/trpc/react'

// Extended snippet interface for table display with API relations
interface TableSnippet {
  id: string
  title: string
  content: string
  contentHtml?: string | null
  description?: string | null
  createdAt: Date
  updatedAt: Date
  isFavorite: boolean
  sharingType: SnippetSharingType
  folder?: {
    id: string
    name: string
  } | null
  createdBy: {
    id: string
    name: string | null
    email: string | null
    image: string | null
  }
  _count: {
    shares: number
  }
}
// Get sharing type label
const getSharingTypeInfo = (type: SnippetSharingType, shareCount: number) => {
  switch (type) {
    case 'PRIVATE':
      return {
        label: 'Private',
        icon: <UserIcon size={14} className='mr-1' />,
        color: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
      }
    case 'ORGANIZATION':
      return {
        label: 'Organization',
        icon: <UsersIcon size={14} className='mr-1' />,
        color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
      }
    case 'GROUPS':
      return {
        label: `${shareCount} Group${shareCount !== 1 ? 's' : ''}`,
        icon: <UsersIcon size={14} className='mr-1' />,
        color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
      }
    case 'MEMBERS':
      return {
        label: `${shareCount} Member${shareCount !== 1 ? 's' : ''}`,
        icon: <UsersIcon size={14} className='mr-1' />,
        color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
      }
    default:
      return {
        label: 'Unknown',
        icon: null,
        color: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
      }
  }
}
// Format relative time
const formatRelativeTime = (date: Date) => {
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}
interface SnippetTableProps {
  onEdit: (snippet: TableSnippet) => void
  onCopy: (snippet: TableSnippet) => void
}
export function SnippetTable({ onEdit, onCopy }: SnippetTableProps) {
  // Use snippet context
  const {
    selectedFolderId,
    searchTerm,
    setSearchTerm,
    folders,
    currentFolderName,
    deleteSnippet,
    updateSnippet,
    isDeletingSnippet,
    isUpdatingSnippet,
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
  // Fetch snippets
  const { data, isLoading } = api.snippet.all.useQuery(
    {
      folderId: selectedFolderId || undefined,
      searchQuery: searchTerm || undefined,
      includeShared: true,
    },
    { placeholderData: keepPreviousData, refetchOnWindowFocus: false }
  )
  // Handle delete
  const handleDeleteSnippet = async (snippet: TableSnippet) => {
    const confirmed = await confirm({
      title: 'Delete Snippet',
      description: `Are you sure you want to delete "${snippet.title}"? This action cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
    })
    if (confirmed) {
      try {
        await deleteSnippet(snippet.id)
      } catch (error) {
        // Error handling is done in the context
      }
    }
  }
  // Handle toggle favorite
  const handleToggleFavorite = async (snippet: TableSnippet) => {
    try {
      await updateSnippet(snippet.id, { isFavorite: !snippet.isFavorite })
    } catch (error) {
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
        <div className='relative w-64'>
          <SearchIcon
            size={16}
            className='absolute left-3 top-1/2 -translate-y-1/2 transform text-gray-400'
          />
          <Input
            placeholder='Search snippets...'
            value={localSearchTerm}
            onChange={(e) => setLocalSearchTerm(e.target.value)}
            className='h-8 pl-9 pr-8'
          />
          {localSearchTerm && (
            <Button
              variant='ghost'
              size='icon'
              className='absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 transform'
              onClick={() => {
                setLocalSearchTerm('')
                setSearchTerm('')
              }}>
              <XIcon size={14} />
            </Button>
          )}
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
              {data?.snippets.map((snippet) => {
                const sharingInfo = getSharingTypeInfo(snippet.sharingType, snippet._count.shares)
                return (
                  <TableRow key={snippet.id}>
                    <TableCell className='p-2'>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={() => handleToggleFavorite(snippet)}
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
                      <div className='flex flex-col'>
                        <span>{snippet.title}</span>
                        {snippet.description && (
                          <span className='max-w-md truncate text-xs text-gray-500'>
                            {snippet.description}
                          </span>
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
                      <Badge
                        variant='secondary'
                        className={cn('flex items-center', sharingInfo.color)}>
                        {sharingInfo.icon}
                        {sharingInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className='flex items-center'>
                        <Avatar className='mr-2 h-6 w-6'>
                          <AvatarImage src={snippet.createdBy.image || undefined} />
                          <AvatarFallback>
                            {snippet.createdBy.name?.charAt(0) ||
                              snippet.createdBy.email?.charAt(0) ||
                              '?'}
                          </AvatarFallback>
                        </Avatar>
                        <span className='text-sm'>
                          {snippet.createdBy.name || snippet.createdBy.email || 'Unknown user'}
                        </span>
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
                            <Edit2Icon />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onCopy(snippet)}>
                            <CopyIcon />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDeleteSnippet(snippet)}
                            variant='destructive'>
                            <Trash2Icon />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <ConfirmDialog />
    </div>
  )
}
