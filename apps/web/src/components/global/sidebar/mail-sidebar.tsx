'use client'

import { Button } from '@auxx/ui/components/button'
import { Separator } from '@auxx/ui/components/separator'
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@auxx/ui/components/sidebar'
import { Settings2 } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'
import { PersonalMailGroup } from '~/components/global/sidebar/personal-mail-group'
import { SharedInboxesGroup } from '~/components/global/sidebar/shared-inbox-group'
import { useMailSidebar } from '~/hooks/use-mail-sidebar'
import { ViewsGroup } from './views-group'

export function MailSidebar() {
  // Use the hook to get all state and functions
  const {
    isEditMode,
    inboxes,
    mailViews,
    personalItems,
    inboxesLoading,
    settingsLoading,
    toggleEditMode,
    updateInboxVisibility,
    updateInboxOrder,
    updateViewsVisibility,
    updateViewsOrder,
    updatePersonalItems,
    mailViewsLoading,
    groupVisibility,
    toggleGroupVisibility,
  } = useMailSidebar()

  // Check if all groups are hidden
  const allGroupsHidden = useMemo(
    () => !groupVisibility.personal && !groupVisibility.views && !groupVisibility.shared,
    [groupVisibility]
  )

  // Create stable toggle handlers for each group
  const togglePersonalVisibility = useCallback(
    () => toggleGroupVisibility('personal'),
    [toggleGroupVisibility]
  )
  const toggleViewsVisibility = useCallback(
    () => toggleGroupVisibility('views'),
    [toggleGroupVisibility]
  )
  const toggleSharedVisibility = useCallback(
    () => toggleGroupVisibility('shared'),
    [toggleGroupVisibility]
  )

  // Close edit mode when unmounting
  useEffect(() => {
    return () => {
      if (isEditMode) {
        toggleEditMode()
      }
    }
    // Adding toggleEditMode to the dependency array is safe because it's memoized
  }, [isEditMode, toggleEditMode])

  return (
    <div className='flex flex-col'>
      <div className=''>
        {/* Empty state when all groups are hidden */}
        {allGroupsHidden && !isEditMode && (
          <SidebarGroup className='group'>
            <SidebarMenu className='gap-0'>
              <SidebarMenuItem>
                <SidebarMenuButton asChild className='h-7 py-0 pe-[3px]' tooltip='Edit Sidebar'>
                  <button
                    onClick={toggleEditMode}
                    className='group/item flex h-7 w-full items-center'>
                    <span className='[&_svg]:size-4 mr-2'>
                      <Settings2 />
                    </span>
                    <span className='group-data-[collapsible=icon]:hidden'>Edit Sidebar</span>
                  </button>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        )}

        {/* Personal Mail Group */}
        <PersonalMailGroup
          isEditMode={isEditMode}
          onToggleEditMode={toggleEditMode}
          settings={personalItems}
          onUpdateSettings={updatePersonalItems}
          settingsLoading={settingsLoading}
          isGroupVisible={groupVisibility.personal}
          onToggleGroupVisibility={togglePersonalVisibility}
        />

        <ViewsGroup
          views={mailViews}
          isLoading={mailViewsLoading}
          isEditMode={isEditMode}
          onToggleEditMode={toggleEditMode}
          onUpdateViewsVisibility={updateViewsVisibility}
          onReorderViews={updateViewsOrder}
          isGroupVisible={groupVisibility.views}
          onToggleGroupVisibility={toggleViewsVisibility}
        />

        {/* Shared Inboxes Group */}
        <SharedInboxesGroup
          inboxes={inboxes}
          isLoading={inboxesLoading}
          isEditMode={isEditMode}
          onToggleEditMode={toggleEditMode}
          onUpdateInboxVisibility={updateInboxVisibility}
          onReorderInboxes={updateInboxOrder}
          isGroupVisible={groupVisibility.shared}
          onToggleGroupVisibility={toggleSharedVisibility}
        />
      </div>

      {/* Footer section for Done button */}
      {isEditMode && (
        <div className='flex shrink-0 items-center justify-end gap-2 border-t p-2'>
          <Button className='w-full rounded-md' size='sm' onClick={toggleEditMode}>
            Done
          </Button>
        </div>
      )}
      <Separator className='mt-1 mb-2' />
    </div>
  )
}
