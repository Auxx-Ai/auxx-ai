// hooks/use-mail-sidebar.ts
import { useCallback, useMemo, useRef, useState } from 'react'
import type { PersonalMenuItem } from '~/components/global/sidebar/personal-mail-group'
import type { Inbox } from '~/components/global/sidebar/shared-inbox-group'
import { useInboxes } from '~/components/threads/hooks'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'

export interface UseMailSidebarOptions {
  scope?: string
}

// Setting keys
const VIEWS_ORDER_SETTING_KEY = 'sidebar.viewsOrder'
const VIEWS_VISIBILITY_SETTING_KEY = 'sidebar.views'
const INBOX_ORDER_SETTING_KEY = 'sidebar.inboxOrder'
const INBOX_VISIBILITY_SETTING_KEY = 'sidebar.inboxes'
const PERSONAL_ITEMS_SETTING_KEY = 'sidebar.personalItems'
const GROUP_VISIBILITY_SETTING_KEY = 'sidebar.groupVisibility'

// Group visibility type
export interface GroupVisibilitySettings {
  personal: boolean
  views: boolean
  shared: boolean
}

export function useMailSidebar({ scope = 'SIDEBAR' }: UseMailSidebarOptions = {}) {
  // Use state for edit mode
  const [isEditMode, setIsEditMode] = useState(false)

  // Add a ref to track the last toggle timestamp to prevent double-calls
  const lastToggleTime = useRef<number>(0)

  // Get settings from the useSettings hook
  const { getSetting, updateUserSetting, isLoading: settingsLoading } = useSettings({ scope })

  // Fetch inboxes data using useInboxes hook (reactive to Zustand store updates)
  const { inboxes: rawInboxes, isLoading: inboxesLoading, refresh: refetchInboxes } = useInboxes()

  const {
    data: mailViews,
    isLoading: mailViewsLoading,
    refetch: refetchMailViews,
  } = api.mailView.getAllAccessibleMailViews.useQuery(undefined, {
    // Don't refetch on window focus to avoid disrupting edit mode
    refetchOnWindowFocus: !isEditMode,
  })

  // Process inboxes: apply saved order and visibility
  const processedInboxes = useMemo((): Inbox[] => {
    if (!rawInboxes || rawInboxes.length === 0) return []

    // 1. Get saved order and visibility settings
    const inboxOrder = (getSetting(INBOX_ORDER_SETTING_KEY) as string[]) || []
    const inboxVisibilitySettings =
      (getSetting(INBOX_VISIBILITY_SETTING_KEY) as Record<string, boolean>) || {}

    // 2. Create a map for quick lookup
    const inboxMap = new Map(rawInboxes.map((inbox) => [inbox.id, inbox]))

    // 3. Create the sorted list based on saved order
    const sortedInboxes: Inbox[] = []
    const processedIds = new Set<string>()

    inboxOrder.forEach((id) => {
      const inbox = inboxMap.get(id)
      if (inbox) {
        sortedInboxes.push({
          id: inbox.id,
          name: inbox.name,
          color: inbox.color ?? '#4F46E5', // Default indigo color
          isVisible: inboxVisibilitySettings[inbox.id] !== false, // Default true
        })
        processedIds.add(id)
      }
    })

    // 4. Append any inboxes not present in the saved order
    rawInboxes.forEach((inbox) => {
      if (!processedIds.has(inbox.id)) {
        sortedInboxes.push({
          id: inbox.id,
          name: inbox.name,
          color: inbox.color ?? '#4F46E5', // Default indigo color
          isVisible: inboxVisibilitySettings[inbox.id] !== false, // Default true
        })
      }
    })
    return sortedInboxes
  }, [rawInboxes, getSetting])

  const viewsOrder = (getSetting(VIEWS_ORDER_SETTING_KEY) as string[]) || []
  const viewsVisibilitySettings =
    (getSetting(VIEWS_VISIBILITY_SETTING_KEY) as Record<string, boolean>) || {}

  // Process mail views: apply saved order and visibility
  const processedViews = useMemo((): Inbox[] => {
    if (!mailViews) return []

    // 1. Get saved order and visibility settings
    const viewsOrder = (getSetting(VIEWS_ORDER_SETTING_KEY) as string[]) || []
    const viewsVisibilitySettings =
      (getSetting(VIEWS_VISIBILITY_SETTING_KEY) as Record<string, boolean>) || {}

    // 2. Create a map for quick lookup
    const viewsMap = new Map(mailViews.map((view) => [view.id, view]))

    // 3. Create the sorted list based on saved order
    const sortedViews: Inbox[] = []
    const processedIds = new Set<string>()

    viewsOrder.forEach((id) => {
      const view = viewsMap.get(id)
      if (view) {
        sortedViews.push({
          ...view,
          isVisible: viewsVisibilitySettings[view.id] !== false, // Default true
        })
        processedIds.add(id)
      }
    })

    // 4. Append any inboxes not present in the saved order
    mailViews.forEach((view) => {
      if (!processedIds.has(view.id)) {
        sortedViews.push({
          ...view,
          isVisible: viewsVisibilitySettings[view.id] !== false, // Default true
        })
      }
    })
    return sortedViews
  }, [mailViews, getSetting])

  // Get personal mail items
  const personalItems = useMemo(
    () => (getSetting(PERSONAL_ITEMS_SETTING_KEY) as PersonalMenuItem[]) || [],
    [getSetting]
  )

  // Get group visibility settings
  const groupVisibility = useMemo((): GroupVisibilitySettings => {
    const settings = (getSetting(GROUP_VISIBILITY_SETTING_KEY) as Record<string, boolean>) || {}
    return {
      personal: settings.personal !== false, // Default true
      views: settings.views !== false, // Default true
      shared: settings.shared !== false, // Default true
    }
  }, [getSetting])

  // Toggle edit mode - with debounce to prevent double-calls
  const toggleEditMode = useCallback(() => {
    const now = Date.now()
    // Prevent multiple toggles within 300ms
    if (now - lastToggleTime.current < 300) {
      console.log('Toggle prevented - too soon')
      return
    }

    console.log('Toggle edit mode:', !isEditMode)
    lastToggleTime.current = now
    setIsEditMode((prev) => !prev)
  }, [isEditMode])

  // Update inbox visibility
  const updateInboxVisibility = useCallback(
    (inboxId: string, isVisible: boolean) => {
      const currentSettings =
        (getSetting(INBOX_VISIBILITY_SETTING_KEY) as Record<string, boolean>) || {}
      const updatedSettings = { ...currentSettings, [inboxId]: isVisible }

      updateUserSetting(INBOX_VISIBILITY_SETTING_KEY, updatedSettings)
    },
    [getSetting, updateUserSetting]
  )

  // Update views visibility
  const updateViewsVisibility = useCallback(
    (viewId: string, isVisible: boolean) => {
      const currentSettings =
        (getSetting(VIEWS_VISIBILITY_SETTING_KEY) as Record<string, boolean>) || {}
      const updatedSettings = { ...currentSettings, [viewId]: isVisible }

      updateUserSetting(VIEWS_VISIBILITY_SETTING_KEY, updatedSettings)
    },
    [getSetting, updateUserSetting]
  )

  // Update inbox order
  const updateInboxOrder = useCallback(
    (orderedInboxIds: string[]) => {
      updateUserSetting(INBOX_ORDER_SETTING_KEY, orderedInboxIds)
    },
    [updateUserSetting]
  )

  // Update views order
  const updateViewsOrder = useCallback(
    (orderedViewIds: string[]) => {
      updateUserSetting(VIEWS_ORDER_SETTING_KEY, orderedViewIds)
    },
    [updateUserSetting]
  )

  // Update personal items
  const updatePersonalItems = useCallback(
    (items: PersonalMenuItem[]) => {
      updateUserSetting(PERSONAL_ITEMS_SETTING_KEY, items)
    },
    [updateUserSetting]
  )

  // Update group visibility
  const updateGroupVisibility = useCallback(
    (groupId: 'personal' | 'views' | 'shared', isVisible: boolean) => {
      const currentSettings =
        (getSetting(GROUP_VISIBILITY_SETTING_KEY) as Record<string, boolean>) || {}
      const updatedSettings = { ...currentSettings, [groupId]: isVisible }
      updateUserSetting(GROUP_VISIBILITY_SETTING_KEY, updatedSettings)
    },
    [getSetting, updateUserSetting]
  )

  // Toggle group visibility
  const toggleGroupVisibility = useCallback(
    (groupId: 'personal' | 'views' | 'shared') => {
      const currentSettings =
        (getSetting(GROUP_VISIBILITY_SETTING_KEY) as Record<string, boolean>) || {}
      const currentValue = currentSettings[groupId] !== false
      updateGroupVisibility(groupId, !currentValue)
    },
    [getSetting, updateGroupVisibility]
  )

  return {
    isEditMode,
    inboxes: processedInboxes,
    personalItems,
    inboxesLoading,
    settingsLoading,
    toggleEditMode,
    updateInboxVisibility,
    updateInboxOrder,
    updateViewsVisibility,
    updateViewsOrder,
    updatePersonalItems,
    refetchInboxes,
    mailViews: processedViews,
    mailViewsLoading,
    groupVisibility,
    updateGroupVisibility,
    toggleGroupVisibility,
  }
}
