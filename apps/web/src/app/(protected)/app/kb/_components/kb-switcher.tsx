'use client'

import { Avatar, AvatarFallback } from '@auxx/ui/components/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { Book, ChevronsUpDown, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'
import { KnowledgeBaseDialog, type KnowledgeBaseFormValues } from './kb-knowledge-base-dialog'
// import {
//   KnowledgeBaseDialog,
//   KnowledgeBaseFormValues,
// } from '~/components/knowledge-base/knowledge-base-dialog'

export function KBSwitcher() {
  const router = useRouter()
  // const { isMobile } = useSidebar()
  const isMobile = false // Placeholder for mobile check, replace with actual logic

  // State for the selected knowledge base
  const [activeKBId, setActiveKBId] = useState<string>('')

  // State for the create dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  // Fetch all knowledge bases
  const { data: knowledgeBases, isLoading, refetch } = api.kb.list.useQuery()

  // Create knowledge base mutation
  const createKnowledgeBase = api.kb.create.useMutation({
    onSuccess: (data) => {
      setShowCreateDialog(false)
      refetch()
      toastSuccess({
        title: 'Knowledge Base Created',
        description: `"${data.name}" has been created successfully.`,
      })

      // Navigate to the new knowledge base
      router.push(`/app/kb/${data.id}/editor`)
    },
    onError: (error) => {
      toastError({ title: 'Error', description: error.message })
    },
  })

  // Effect to set the active KB when knowledge bases are loaded
  useEffect(() => {
    if (knowledgeBases && knowledgeBases.length > 0 && !activeKBId) {
      console.log('Setting active KB ID:', knowledgeBases[0].id)
      setActiveKBId(knowledgeBases[0].id)
    }
  }, [knowledgeBases, activeKBId])

  // Handle knowledge base selection
  const handleClickKnowledgeBase = (knowledgeBaseId: string) => {
    setActiveKBId(knowledgeBaseId)
    router.push(`/app/kb/${knowledgeBaseId}/editor`)
  }

  // Handle form submission
  const handleCreateSubmit = (values: KnowledgeBaseFormValues) => {
    createKnowledgeBase.mutate({
      name: values.name,
      slug: values.slug,
      isPublic: values.isPublic ?? false,
    })
  }

  // Get the active knowledge base
  const activeKB = knowledgeBases?.find((kb) => kb.id === activeKBId)

  // Generate initials for the avatar
  const getInitials = (name?: string) => {
    if (!name) return 'KB'
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .substring(0, 2)
  }

  return (
    <>
      {/* Use the new dialog component */}
      <KnowledgeBaseDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSubmit={handleCreateSubmit}
        isSubmitting={createKnowledgeBase.isLoading}
        mode='create'
      />

      {/* KB Switcher */}
      {/* <SidebarMenu>
        <SidebarMenuItem> */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div className='peer/menu-button border bg-primary-50 flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] hover:border-primary-200 hover:bg-primary-100 hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-primary-100 active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-primary-100 data-[state=open]:bg-primary-100 data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:text-sidebar-accent-foreground data-[state=open]:hover:bg-primary-100 data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0'>
            <Avatar className='h-8 w-8 rounded-lg'>
              <AvatarFallback className='rounded-lg bg-primary/10'>
                {activeKB ? getInitials(activeKB.name) : 'KB'}
              </AvatarFallback>
            </Avatar>
            <div className='grid flex-1 text-left text-sm leading-tight'>
              <span className='truncate font-semibold'>
                {isLoading ? 'Loading...' : activeKB?.name || 'Knowledge Base'}
              </span>
              <span className='truncate text-xs'>{activeKB?.isPublic ? 'Public' : 'Private'}</span>
            </div>
            <ChevronsUpDown className='ml-auto size-4' />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg'
          side='bottom'
          align='end'
          sideOffset={4}>
          <DropdownMenuLabel className='p-0 font-normal'>
            <div className='flex items-center gap-2 px-1 py-1.5 text-left text-sm'>
              <Avatar className='h-8 w-8 rounded-lg'>
                <AvatarFallback className='rounded-lg bg-primary/10 text-primary'>
                  {activeKB ? getInitials(activeKB.name) : 'KB'}
                </AvatarFallback>
              </Avatar>
              <div className='grid flex-1 text-left text-sm leading-tight'>
                <span className='truncate font-semibold'>
                  {isLoading ? 'Loading...' : activeKB?.name || 'Knowledge Base'}
                </span>
                <span className='truncate text-xs'>
                  {activeKB?.isPublic ? 'Public' : 'Private'}
                </span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={activeKBId} onValueChange={handleClickKnowledgeBase}>
            {isLoading ? (
              <DropdownMenuItem disabled>Loading...</DropdownMenuItem>
            ) : knowledgeBases && knowledgeBases.length > 0 ? (
              knowledgeBases.map((kb) => (
                <DropdownMenuRadioItem value={kb.id} key={kb.id} className='gap-2 p-2'>
                  <div className='flex size-6 items-center justify-center rounded-sm border'>
                    <Book className='size-4 shrink-0' />
                  </div>
                  {kb.name}
                </DropdownMenuRadioItem>
              ))
            ) : (
              <DropdownMenuItem disabled>No knowledge bases found</DropdownMenuItem>
            )}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowCreateDialog(true)}>
            <Plus />
            Add Knowledge Base
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* </SidebarMenuItem>
      </SidebarMenu> */}
    </>
  )
}
