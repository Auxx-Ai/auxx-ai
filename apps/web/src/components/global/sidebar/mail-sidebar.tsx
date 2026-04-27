'use client'

import { Button } from '@auxx/ui/components/button'
import { SidebarGroup, SidebarGroupCollapse, SidebarMenu } from '@auxx/ui/components/sidebar'
import { useCallback, useEffect } from 'react'
import { PersonalMailItems } from '~/components/global/sidebar/personal-mail-group'
import { SharedInboxesSection } from '~/components/global/sidebar/shared-inbox-group'
import { useMailSidebar } from '~/hooks/use-mail-sidebar'
import { SidebarGroupHeader } from './sidebar-group-header'
import { useSidebarStateContext } from './sidebar-state-context'
import { ViewsSection } from './views-group'

export function MailSidebar() {
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

  const { getGroupOpen, toggleGroup } = useSidebarStateContext()
  const isMailOpen = getGroupOpen('mail')

  const handleToggleMailOpen = useCallback(() => {
    toggleGroup('mail')
  }, [toggleGroup])

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
  }, [isEditMode, toggleEditMode])

  return (
    <>
      <SidebarGroup className='group'>
        <SidebarGroupHeader
          title='Mail'
          isEditMode={isEditMode}
          onToggleEditMode={toggleEditMode}
          isOpen={isMailOpen}
          toggleOpen={handleToggleMailOpen}
        />
        <SidebarGroupCollapse open={isEditMode || isMailOpen}>
          <SidebarMenu className='gap-0'>
            <PersonalMailItems
              isEditMode={isEditMode}
              onToggleEditMode={toggleEditMode}
              settings={personalItems}
              onUpdateSettings={updatePersonalItems}
              settingsLoading={settingsLoading}
            />
            <ViewsSection
              views={mailViews}
              isLoading={mailViewsLoading}
              isEditMode={isEditMode}
              onToggleEditMode={toggleEditMode}
              onUpdateViewsVisibility={updateViewsVisibility}
              onReorderViews={updateViewsOrder}
              isSectionVisible={groupVisibility.views}
              onToggleSectionVisibility={toggleViewsVisibility}
            />
            <SharedInboxesSection
              inboxes={inboxes}
              isLoading={inboxesLoading}
              isEditMode={isEditMode}
              onToggleEditMode={toggleEditMode}
              onUpdateInboxVisibility={updateInboxVisibility}
              onReorderInboxes={updateInboxOrder}
              isSectionVisible={groupVisibility.shared}
              onToggleSectionVisibility={toggleSharedVisibility}
            />
          </SidebarMenu>
        </SidebarGroupCollapse>
      </SidebarGroup>

      {isEditMode && (
        <div className='flex shrink-0 items-center justify-end gap-2 border-t p-2'>
          <Button className='w-full rounded-md' size='sm' onClick={toggleEditMode}>
            Done
          </Button>
        </div>
      )}
    </>
  )
}
