'use client'

import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { buildConditionGroups } from '@auxx/lib/mail-query/client'
import { InternalFilterContextType } from '@auxx/lib/types'
import { Button } from '@auxx/ui/components/button'
import {
  type DockedPanelConfig,
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { PanelResizeHandle } from '@auxx/ui/components/panel-resize-handle'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { cn } from '@auxx/ui/lib/utils'
import {
  ChevronLeft,
  Columns2,
  Mail,
  Plus,
  Rows2,
  Rows3,
  Rows4,
  Search,
  Waypoints,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQueryState } from 'nuqs'
import {
  useCallback,
  useDeferredValue, // Import for optimizing search input
  useEffect,
  useMemo,
  useState,
} from 'react'
import { ContactDrawer } from '~/components/contacts/drawer/contact-drawer'
import { EmptyState } from '~/components/global/empty-state'
import { useKopilotStore } from '~/components/kopilot/stores/kopilot-store'
import {
  MailFilterProvider,
  type SortDirection,
  type SortOption,
} from '~/components/mail/mail-filter-context'
// import SearchBar from '~/components/mail/mail-searchbar'
import { ThreadList } from '~/components/mail/mail-thread-list'
// import { ProposedActionsView } from './proposed-actions-view'
import { MailSearchBar } from '~/components/mail/searchbar'
// import { MailFilterProvider } from '~/context/mail-filter-context' // Import the provider
import { useSearchConditions } from '~/components/mail/searchbar/hooks/use-search-filters'
import { ThreadDisplay } from '~/components/mail/thread-display'
import { ThreadNavToolbar } from '~/components/mail/thread-nav-toolbar'
import type { ThreadsFilterInput } from '~/components/mail/types'
import {
  useActiveThreadId,
  useActiveThreadVersion,
  useSelectedThreadIds,
  useThreadSelectionStore,
  useViewMode,
} from '~/components/threads'
import { useCompose } from '~/hooks/use-compose'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useUser } from '~/hooks/use-user'
import { safeLocalStorage } from '~/lib/safe-localstorage'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { useDockStore } from '~/stores/dock-store'
import { api } from '~/trpc/react'
import {
  calculateBasePathForList,
  constructTabNavigationPath,
  deriveActiveStatusSlug,
  parseMailboxContext,
} from '../_utils/mail-utils'
import {
  getBreadcrumbTitleForContext,
  getDisplayTabsForContext,
  isPersonalContext,
  isSharedContext,
} from '../_utils/mailbox-utils'
import { MailboxStatusDropdown } from './mailbox-status-dropdown'

/**
 * Props for the Mailbox component.
 */
type MailboxProps = {
  /** Type of context (e.g., 'personal_inbox', 'tag'). Determines the overall view. */
  contextType: string
  /** Optional ID related to the context (e.g., tagId, viewId, inboxId). */
  contextId?: string
  /** Initial status slug derived from the URL, defaults to 'open'. */
  initialStatusSlug?: string
  /** Initial search query derived from URL params. */
  initialSearchQuery?: string
}

/**
 * Legacy function - now using parseMailboxContext from utils
 * @deprecated Use parseMailboxContext from mail-utils instead
 */
export function getMailboxContextType(pathname: string) {
  return parseMailboxContext(pathname)
}

export function Mailbox({
  contextType,
  contextId,
  initialStatusSlug = 'open',
  initialSearchQuery = '',
}: MailboxProps) {
  const { hasIntegrations, isLoading } = useUser({
    requireOrganization: true, // Require organization membership
  })
  if (isLoading) {
    return (
      <EmptyState
        icon={Mail}
        iconClassName='animate-spin'
        title='Loading...'
        description={<>Hang on tight while we load your inbox...</>}
        button={<div className='h-12'></div>}
      />
    )
  }
  if (!isLoading && !hasIntegrations) {
    return (
      <EmptyState
        icon={Waypoints}
        title='No channels found'
        description={<>Link your email account to get started.</>}
        button={
          <Link href='/app/settings/channels/new'>
            <Button type='button' size='sm' variant='outline'>
              <Plus />
              Get started
            </Button>
          </Link>
        }
      />
    )
  }

  return (
    <MailboxInner
      contextType={contextType}
      contextId={contextId}
      initialStatusSlug={initialStatusSlug}
      initialSearchQuery={initialSearchQuery}
    />
  )
}

/**
 * Mailbox component orchestrates the mail interface layout, including
 * sidebar context, status tabs, search, thread list, and thread display.
 * It manages filtering state and interaction between components.
 */
function MailboxInner({
  contextType,
  contextId,
  initialStatusSlug = 'open',
  initialSearchQuery = '',
}: MailboxProps) {
  const { openCompose } = useCompose()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Layout mode: 'split' (two-panel) or 'list' (compact single-panel), persisted in localStorage
  const [layoutMode, setLayoutMode] = useState<'split' | 'list'>(() => {
    const stored = safeLocalStorage.get('mail-layout-mode')
    return stored === 'list' ? 'list' : 'split'
  })
  const handleLayoutModeChange = useCallback((mode: string) => {
    const value = mode as 'split' | 'list'
    setLayoutMode(value)
    safeLocalStorage.set('mail-layout-mode', value)
  }, [])

  // Get current user ID for personal inbox/assigned filtering
  const { userId } = useUser()

  // Dock state for contact drawer
  const isDocked = useEffectiveDockState()
  const dockedWidth = useDockStore((state) => state.dockedWidth)
  const setDockedWidth = useDockStore((state) => state.setDockedWidth)
  const minWidth = useDockStore((state) => state.minWidth)
  const maxWidth = useDockStore((state) => state.maxWidth)

  // Contact drawer state from URL (shared with participant-display.tsx)
  const [contactId, setContactId] = useQueryState('contactId', { defaultValue: '' })
  const isContactDrawerOpen = !!contactId

  // Kopilot — push page context so the global KopilotDock knows what's on-screen
  const { hasAccess } = useFeatureFlags()
  const kopilotEnabled = hasAccess('kopilot')
  const setKopilotContext = useKopilotStore((s) => s.setContext)

  // Use new selection store directly
  const selectedThreads = useSelectedThreadIds()

  // Fetch pending actions count
  // const { data: pendingActionsCount } = api.proposedAction.getPendingCount.useQuery(undefined, {
  //   refetchInterval: 5 * 60 * 1000, // Refetch 2 min
  //   enabled: mode === 'mail', // Only fetch when in mail mode
  // })

  // State for the primary search query value (updated after debounce from SearchBar)
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || searchParams?.get('q') || '')
  // Deferred version of the search query to avoid blocking UI updates during typing
  const deferredSearchQuery = useDeferredValue(searchQuery)

  // Get search conditions from store for condition-based filtering
  const searchConditions = useSearchConditions()

  // For view contexts, fetch the view's saved filter conditions
  const { data: mailViewData } = api.mailView.getById.useQuery(
    { id: contextId! },
    { enabled: contextType === 'view' && !!contextId }
  )

  // Selected thread ID persisted in URL via nuqs for reload support
  const [tid, setTid] = useQueryState('tid', {
    defaultValue: '',
    history: 'replace',
    shallow: true,
  })
  const selectedThreadId = tid || null

  // State to track if the thread list is currently fetching/loading data
  const [isListLoading, setIsListLoading] = useState(false)

  console.log('[thread-load] MailboxInner render', {
    tid,
    storeActiveThreadId: useThreadSelectionStore.getState().activeThreadId,
    selectedThreadId,
  })

  // Sync URL ↔ Zustand on mount (restore active thread after reload or navigation).
  // We deliberately do NOT seed selectedThreadIds here — the checkbox selection is
  // a separate, user-driven concept from "which thread is open".
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    const store = useThreadSelectionStore.getState()
    console.log('[thread-load] MailboxInner mount effect', {
      tid,
      storeActiveThreadId: store.activeThreadId,
    })
    if (tid) {
      if (!store.activeThreadId) {
        console.log('[thread-load] → setActiveThread(tid)', tid)
        store.setActiveThread(tid)
      }
    } else if (store.activeThreadId) {
      console.log('[thread-load] → setTid(store.activeThreadId)', store.activeThreadId)
      void setTid(store.activeThreadId)
    }
  }, [])

  // View mode from store - determines checkbox visibility and interaction behavior
  const viewMode = useViewMode()

  // Sync Zustand → URL (persist active thread when user clicks a thread row)
  const activeThreadId = useActiveThreadId()
  const activeThreadVersion = useActiveThreadVersion()

  // Push page context to Kopilot global dock
  useEffect(() => {
    if (!kopilotEnabled) return
    setKopilotContext({ page: 'mail', activeThreadId: activeThreadId ?? undefined })
    return () => setKopilotContext(null)
  }, [kopilotEnabled, activeThreadId, setKopilotContext])

  useEffect(() => {
    if (activeThreadId) {
      void setTid(activeThreadId)
    } else {
      const { selectedThreadIds } = useThreadSelectionStore.getState()
      if (selectedThreadIds.length === 0) {
        void setTid('')
      }
    }
  }, [activeThreadId, activeThreadVersion, setTid])
  const setViewMode = useThreadSelectionStore((s) => s.setViewMode)

  // Mobile search toggle
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)

  // State for sorting - default to newest first
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  // Determine the active status slug based on the current URL path using utility
  const activeStatusSlug = deriveActiveStatusSlug(pathname, initialStatusSlug)

  // Get display configuration for this mailbox context
  const displayTabs = getDisplayTabsForContext(contextType)
  const breadcrumbTitle = getBreadcrumbTitleForContext(contextType)

  // Build the unified filter using condition groups
  // Combines context (from URL) with search conditions (from searchbar store)
  // For views, also merges the view's saved filter groups
  const filterConditions = useMemo(() => {
    const groups = buildConditionGroups(
      {
        contextType,
        contextId,
        statusSlug: activeStatusSlug === 'all' ? undefined : activeStatusSlug,
        userId,
      },
      searchConditions
    )

    // Prepend the view's saved filter groups so they're always applied
    if (contextType === 'view' && mailViewData?.filters) {
      const viewFilters = mailViewData.filters as ConditionGroup[]
      if (viewFilters.length > 0) {
        return [...viewFilters, ...groups]
      }
    }

    return groups
  }, [contextType, contextId, activeStatusSlug, userId, searchConditions, mailViewData])

  getMailboxContextType(pathname)
  const mailFilterContextValue = useMemo(
    () => ({
      contextType,
      contextId,
      statusSlug: activeStatusSlug, // Use the active slug derived from URL/state
      searchQuery: deferredSearchQuery || undefined, // Use deferred query for consistency
      selectedThreadIds: selectedThreads, // Pass selected IDs down
      viewMode, // Add view mode state
      sortBy, // Add sort option state
      sortDirection, // Add sort direction state
      filterConditions, // Pre-built conditions for client-side filtering
      setViewMode, // Add view mode setter
      setSortBy, // Add sort option setter
      setSortDirection, // Add sort direction setter
    }),
    [
      contextType,
      contextId,
      activeStatusSlug,
      deferredSearchQuery,
      selectedThreads,
      viewMode,
      sortBy,
      sortDirection,
      filterConditions,
      setViewMode,
    ]
  )

  // Helper to map UI sort options to sort field names
  const mapSortByToField = (sortBy: string): 'lastMessageAt' | 'subject' | 'sender' => {
    switch (sortBy) {
      case 'newest':
      case 'oldest':
        return 'lastMessageAt'
      case 'subject':
        return 'subject'
      case 'sender':
        return 'sender'
      default:
        return 'lastMessageAt'
    }
  }

  // Build the thread filter input using pre-built conditions
  // biome-ignore lint/correctness/useExhaustiveDependencies: mapSortByToField is a stable local function
  const threadFilterForHook: ThreadsFilterInput = useMemo(
    () => ({
      filter: filterConditions,
      sort: {
        field: mapSortByToField(sortBy),
        direction: sortDirection,
      },
    }),
    [filterConditions, sortBy, sortDirection]
  )

  // Calculate the base path for constructing links within the ThreadList using utility
  const basePathForList = calculateBasePathForList(pathname)

  // Handles navigation when a status tab is clicked using utility function
  const handleTabChange = useCallback(
    (newStatusSlug: string) => {
      const newPath = constructTabNavigationPath(pathname, newStatusSlug)

      console.debug(`Routing tab change to: ${newPath}`)
      router.push(newPath)
    },
    [pathname, router]
  )

  // Handles updates from the SearchBar component (called after debounce)
  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query)
    },
    [] // No dependencies needed if only setting state
  )

  // Thread list width in pixels, persisted to localStorage
  const [threadListWidth, setThreadListWidth] = useState(() => {
    const stored = safeLocalStorage.get('mail-thread-list-width')
    return stored ? Number(stored) : 350
  })
  const handleThreadListResize = useCallback((width: number) => {
    setThreadListWidth(width)
    safeLocalStorage.set('mail-thread-list-width', String(width))
  }, [])

  // Handles navigation back to thread list
  const handleBackToList = useCallback(() => {
    void setTid('')
    useThreadSelectionStore.getState().setActiveThread(null)
    router.push(basePathForList)
  }, [router, basePathForList, setTid])

  // Handle closing contact drawer
  const handleContactDrawerClose = useCallback(
    (open: boolean) => {
      void setContactId(open ? contactId : '')
    },
    [contactId, setContactId]
  )

  // Build docked panels for contact drawer
  const dockedPanels = useMemo<DockedPanelConfig[]>(() => {
    const panels: DockedPanelConfig[] = []

    if (isDocked && isContactDrawerOpen) {
      panels.push({
        key: 'contact',
        content: (
          <ContactDrawer
            contactId={contactId}
            open={isContactDrawerOpen}
            onOpenChange={handleContactDrawerClose}
          />
        ),
        width: dockedWidth,
        onWidthChange: setDockedWidth,
        minWidth,
        maxWidth,
      })
    }

    return panels
  }, [
    isDocked,
    isContactDrawerOpen,
    contactId,
    handleContactDrawerClose,
    dockedWidth,
    setDockedWidth,
    minWidth,
    maxWidth,
  ])

  return (
    <MailFilterProvider value={mailFilterContextValue}>
      <MainPage>
        <MainPageHeader
          action={
            <div className='flex items-center gap-1'>
              <Button
                variant='info'
                size='sm'
                className='h-7 rounded-lg'
                onClick={() => openCompose()}>
                Compose
              </Button>
            </div>
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title='Mail' href='/app/mail' />
            {(contextType === InternalFilterContextType.DRAFTS ||
              contextType === InternalFilterContextType.SENT) && (
              <MainPageBreadcrumbItem
                title={breadcrumbTitle}
                href={
                  contextType === InternalFilterContextType.DRAFTS
                    ? '/app/mail/drafts'
                    : '/app/mail/sent'
                }
                last
              />
            )}
            {isPersonalContext(contextType) &&
              contextType !== InternalFilterContextType.DRAFTS &&
              contextType !== InternalFilterContextType.SENT && (
                <MainPageBreadcrumbItem title={breadcrumbTitle} last />
              )}
            {isSharedContext(contextType) && (
              <MainPageBreadcrumbItem title={breadcrumbTitle} last />
            )}
          </MainPageBreadcrumb>
        </MainPageHeader>
        <MainPageContent dockedPanels={dockedPanels}>
          <div
            data-search-expanded={mobileSearchOpen || undefined}
            className='group/toolbar flex items-center justify-between bg-primary-150 border-b w-full rounded-t-lg px-2 h-10.5 shrink-0'>
            {/* Status Dropdown and Search Bar */}
            <div className='w-full flex flex-1 justify-between overflow-x-auto no-scrollbar gap-2'>
              <div className='flex flex-1 items-center gap-2'>
                {displayTabs.length > 0 && (
                  <div className='group-data-search-expanded/toolbar:hidden'>
                    <MailboxStatusDropdown
                      availableStatuses={displayTabs}
                      selectedStatus={activeStatusSlug}
                      onStatusChange={handleTabChange}
                    />
                  </div>
                )}

                {/* Mobile search toggle — visible only on small screens when search is collapsed */}
                <Button
                  variant='ghost'
                  size='sm'
                  className='sm:hidden group-data-search-expanded/toolbar:hidden'
                  onClick={() => setMobileSearchOpen(true)}>
                  <Search />
                </Button>

                {/* Search bar — hidden on mobile until expanded */}
                <div className='hidden sm:flex flex-1 group-data-search-expanded/toolbar:flex'>
                  <Button
                    variant='ghost'
                    size='icon-xs'
                    className='hidden group-data-search-expanded/toolbar:flex sm:hidden shrink-0 mt-0.5'
                    onClick={() => {
                      setMobileSearchOpen(false)
                      setSearchQuery('')
                    }}>
                    <ChevronLeft />
                  </Button>
                  <MailSearchBar
                    onSearch={handleSearch}
                    initialQuery={searchQuery}
                    isLoading={isListLoading}
                  />
                </div>
              </div>
              <div className='flex items-center shrink-0 gap-2 max-sm:group-data-search-expanded/toolbar:hidden'>
                <RadioTab
                  value={layoutMode}
                  onValueChange={handleLayoutModeChange}
                  size='sm'
                  className='border border-primary-200 bg-background/30'>
                  <RadioTabItem value='split' size='sm'>
                    {/* Mobile: density metaphor (relaxed rows). Desktop: two-column layout */}
                    <Rows2 className='sm:hidden' />
                    <Columns2 className='hidden sm:block' />
                    <span className='hidden sm:inline'>Split</span>
                  </RadioTabItem>
                  <RadioTabItem value='list' size='sm'>
                    {/* Mobile: compact rows. Desktop: list layout */}
                    <Rows4 className='sm:hidden' />
                    <Rows3 className='hidden sm:block' />
                    <span className='hidden sm:inline'>List</span>
                  </RadioTabItem>
                </RadioTab>
              </div>
            </div>
          </div>
          {/* Unified responsive tree: viewport differences driven by Tailwind
              media queries (sm = 640px). Only layoutMode drives JS branching. */}
          <div
            className={cn(
              'flex flex-row h-full flex-1 overflow-hidden bg-secondary',
              'max-sm:dark:bg-primary-100 sm:dark:bg-muted-50'
            )}>
            {/* ThreadList panel */}
            <div
              style={layoutMode === 'split' ? { width: threadListWidth } : undefined}
              className={cn(
                'flex flex-col overflow-y-hidden min-h-0',
                layoutMode === 'split' ? 'sm:shrink-0 max-sm:w-full! max-sm:flex-1' : 'flex-1',
                // Hide when a thread is selected, per layoutMode/viewport rules
                selectedThreadId && layoutMode === 'list' && 'hidden',
                selectedThreadId && layoutMode === 'split' && 'max-sm:hidden'
              )}>
              <div className='overflow-hidden flex-1 min-h-0'>
                <ThreadList
                  filter={threadFilterForHook}
                  basePath={basePathForList}
                  selectedThreadId={selectedThreadId}
                  onLoadingChange={setIsListLoading}
                  variant={layoutMode === 'list' ? 'compact' : 'default'}
                />
              </div>
            </div>

            {/* Resize handle — split only, hidden on mobile */}
            {layoutMode === 'split' && (
              <PanelResizeHandle
                side='left'
                currentWidth={threadListWidth}
                onWidthChange={handleThreadListResize}
                minWidth={250}
                maxWidth={500}
                className='max-sm:hidden'
              />
            )}

            {/* ThreadDisplay panel */}
            <div
              className={cn(
                'flex-1 min-w-0 flex flex-col',
                !selectedThreadId && layoutMode === 'list' && 'hidden',
                !selectedThreadId && layoutMode === 'split' && 'max-sm:hidden'
              )}>
              {selectedThreadId && (
                <div className={cn(layoutMode === 'split' && 'sm:hidden')}>
                  <ThreadNavToolbar
                    activeThreadId={selectedThreadId}
                    onBack={handleBackToList}
                    onNavigate={(id) => void setTid(id)}
                    hotkeysEnabled={layoutMode !== 'split'}
                  />
                </div>
              )}
              <div className='flex-1 overflow-hidden'>
                <ThreadDisplay centered={layoutMode === 'list'} />
              </div>
            </div>
          </div>
        </MainPageContent>
      </MainPage>

      {/* Overlay contact drawer when NOT docked */}
      {!isDocked && (
        <ContactDrawer
          contactId={contactId}
          open={isContactDrawerOpen}
          onOpenChange={handleContactDrawerClose}
        />
      )}
    </MailFilterProvider>
  )
}
