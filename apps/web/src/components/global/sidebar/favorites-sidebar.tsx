// apps/web/src/components/global/sidebar/favorites-sidebar.tsx
'use client'

import { DropdownMenuItem } from '@auxx/ui/components/dropdown-menu'
import { SidebarGroup, SidebarGroupCollapse, SidebarMenu } from '@auxx/ui/components/sidebar'
import { toastError } from '@auxx/ui/components/toast'
import { FolderPlus } from 'lucide-react'
import { useCallback, useState } from 'react'
import { FavoritesTree } from '~/components/favorites/ui/favorites-tree'
import { SidebarItem } from '~/components/global/sidebar/sidebar-item'
import { api } from '~/trpc/react'
import { SidebarGroupHeader } from './sidebar-group-header'
import { useSidebarStateContext } from './sidebar-state-context'

const GROUP_ID = 'favorites'

export function FavoritesSidebar() {
  const { getGroupOpen, toggleGroup } = useSidebarStateContext()
  const isFavoritesOpen = getGroupOpen(GROUP_ID)
  const handleToggleOpen = useCallback(() => toggleGroup(GROUP_ID), [toggleGroup])

  const [creatingFolder, setCreatingFolder] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')

  const utils = api.useUtils()
  const createFolder = api.favorite.createFolder.useMutation({
    onSuccess: () => {
      void utils.favorite.list.invalidate()
      setCreatingFolder(false)
      setDraftTitle('')
    },
    onError: (error) => {
      toastError({ title: 'Could not create folder', description: error.message })
    },
  })

  const commitCreate = () => {
    const title = draftTitle.trim()
    if (title) createFolder.mutate({ title })
    else setCreatingFolder(false)
  }

  const cancelCreate = () => {
    setCreatingFolder(false)
    setDraftTitle('')
  }

  const additionalOptions = (
    <DropdownMenuItem
      onClick={(e) => {
        e.stopPropagation()
        setDraftTitle('')
        setCreatingFolder(true)
      }}>
      <FolderPlus />
      New folder
    </DropdownMenuItem>
  )

  return (
    <SidebarGroup className='group'>
      <SidebarGroupHeader
        title='Favorites'
        isEditMode={false}
        onToggleEditMode={() => {}}
        isOpen={isFavoritesOpen}
        toggleOpen={handleToggleOpen}
        additionalOptions={additionalOptions}
        hideEditOption
      />
      <SidebarGroupCollapse open={isFavoritesOpen}>
        <SidebarMenu className='gap-0'>
          {creatingFolder && (
            <SidebarItem
              id='__new_folder__'
              name=''
              href='#'
              icon={<FolderPlus />}
              isSubmenu
              isEditing
              editValue={draftTitle}
              onEditChange={setDraftTitle}
              onEditCommit={commitCreate}
              onEditCancel={cancelCreate}
            />
          )}
          <FavoritesTree />
        </SidebarMenu>
      </SidebarGroupCollapse>
    </SidebarGroup>
  )
}
