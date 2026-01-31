'use client'

import React, {
  useState,
  useMemo,
  useCallback,
  useDeferredValue, // Import for optimizing search input
} from 'react'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@auxx/ui/components/resizable'

// import SearchBar from '~/components/mail/mail-searchbar'
import { ThreadList } from '~/components/mail/mail-thread-list'
import { ThreadDisplay } from '~/components/mail/thread-display'
import { InternalFilterContextType } from '@auxx/lib/types'

import {
  MailFilterProvider,
  type ViewMode,
  type SortOption,
  type SortDirection,
} from '~/components/mail/mail-filter-context'
import {
  useSelectedThreadIds,
  KeyboardProvider,
  useViewMode,
  useThreadSelectionStore,
} from '~/components/threads'
import { type ThreadsFilterInput, VALID_STATUS_SLUGS } from '~/components/mail/types'
import { MailboxStatusDropdown } from './mailbox-status-dropdown'
import {
  parseMailboxContext,
  deriveActiveStatusSlug,
  constructTabNavigationPath,
  calculateBasePathForList,
  constructNavigationSearchParams,
  toStatusSlug,
} from '../_utils/mail-utils'
import {
  getDisplayTabsForContext,
  getBreadcrumbTitleForContext,
  isPersonalContext,
  isSharedContext,
} from '../_utils/mailbox-utils'
import { useUser } from '~/hooks/use-user'
import { EmptyState } from '~/components/global/empty-state'
import { Mail, MailIcon, Play, Plus, Waypoints } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'
import Link from 'next/link'
import NewMessageDialog from '~/components/mail/email-editor/new-message-dialog'
import {
  MainPage,
  MainPageBreadcrumb,
  MainPageBreadcrumbItem,
  MainPageContent,
  MainPageHeader,
} from '@auxx/ui/components/main-page'
import { useIsMobile } from '~/hooks/use-mobile'
import { useIsSmallScreen } from '~/hooks/use-small-screen'
import { MobileThreadHeader } from '~/components/mail/mobile-thread-header'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { useQueryState } from 'nuqs'
// import { ProposedActionsView } from './proposed-actions-view'
import { MailSearchBar } from '~/components/mail/searchbar'
import { ContactDrawer } from '~/components/contacts/drawer/contact-drawer'
import { useEffectiveDockState } from '~/hooks/use-effective-dock-state'
import { useDockStore } from '~/stores/dock-store'
// import { MailFilterProvider } from '~/context/mail-filter-context' // Import the provider
import { useSearchConditions } from '~/components/mail/searchbar/hooks/use-search-filters'
import { buildConditionGroups } from '@auxx/lib/mail-query/client'

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
        iconClassName="animate-spin"
        title="Loading..."
        description={<>Hang on tight while we load your inbox...</>}
        button={<div className="h-12"></div>}
      />
    )
  }
  if (!isLoading && !hasIntegrations) {
    return (
      <EmptyState
        icon={Waypoints}
        title="No integrations found"
        description={<>Link your email account to get started.</>}
        button={
          <Link href="/app/settings/integrations/new">
            <Button type="button" size="sm" variant="outline">
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
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [mode, setMode] = useQueryState('mode', {
    defaultValue: 'mail',
    history: 'replace',
    shallow: false,
  })

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

  // State for the currently selected thread ID, derived from URL search parameter 'thread'
  const selectedThreadId = searchParams?.get('selected')

  // State to track if the thread list is currently fetching/loading data
  const [isListLoading, setIsListLoading] = useState(false)

  // View mode from store - determines checkbox visibility and interaction behavior
  const viewMode = useViewMode()
  const setViewMode = useThreadSelectionStore((s) => s.setViewMode)

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
  const filterConditions = useMemo(
    () =>
      buildConditionGroups(
        {
          contextType,
          contextId,
          statusSlug: activeStatusSlug === 'all' ? undefined : activeStatusSlug,
          userId,
        },
        searchConditions
      ),
    [contextType, contextId, activeStatusSlug, userId, searchConditions]
  )

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
      setSortBy,
      setSortDirection,
    ]
  )

  // Helper to map UI sort options to sort field names
  const mapSortByToField = (
    sortBy: string
  ): 'lastMessageAt' | 'subject' | 'sender' => {
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
  const basePathForList = calculateBasePathForList(pathname, selectedThreadId)

  // Handles navigation when a status tab is clicked using utility function
  const handleTabChange = useCallback(
    (newStatusSlug: string) => {
      const newPath = constructTabNavigationPath(pathname, newStatusSlug, selectedThreadId)

      // Preserve other search parameters (like 'q') but remove 'selected'
      const newSearchParams = constructNavigationSearchParams(searchParams, { removeThread: true })
      const queryString = newSearchParams.toString()

      console.debug(`Routing tab change to: ${newPath}${queryString ? `?${queryString}` : ''}`)
      router.push(`${newPath}${queryString ? `?${queryString}` : ''}`)
    },
    [pathname, router, searchParams, selectedThreadId]
  )

  // Handles updates from the SearchBar component (called after debounce)
  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query)
    },
    [] // No dependencies needed if only setting state
  )

  // Default layout configuration for ResizablePanelGroup
  const isMobile = useIsMobile()
  const isSmallScreen = useIsSmallScreen()
  const defaultLayout = isMobile ? [100, 0] : [25, 60]

  // Handles navigation back to thread list on mobile
  const handleBackToList = useCallback(() => {
    const newSearchParams = constructNavigationSearchParams(searchParams, { removeThread: true })
    const queryString = newSearchParams.toString()

    router.push(`${basePathForList}${queryString ? `?${queryString}` : ''}`)
  }, [router, searchParams, basePathForList])

  // Handle closing contact drawer
  const handleContactDrawerClose = useCallback(
    (open: boolean) => {
      void setContactId(open ? contactId : '')
    },
    [contactId, setContactId]
  )

  // Build docked panel content for contact drawer
  const dockedPanel =
    isDocked && isContactDrawerOpen ? (
      <ContactDrawer
        contactId={contactId}
        open={isContactDrawerOpen}
        onOpenChange={handleContactDrawerClose}
      />
    ) : undefined

  return (
    <MailFilterProvider value={mailFilterContextValue}>
      <KeyboardProvider>
      <MainPage loading={true}>
        <MainPageHeader
          action={
            <NewMessageDialog
              trigger={
                <Button variant="info" size="sm" className="h-7 rounded-lg">
                  Compose
                </Button>
              }
            />
          }>
          <MainPageBreadcrumb>
            <MainPageBreadcrumbItem title="Mail" href="/app/mail" />
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
        <MainPageContent
          dockedPanel={dockedPanel}
          dockedPanelWidth={dockedWidth}
          onDockedPanelWidthChange={setDockedWidth}
          dockedPanelMinWidth={minWidth}
          dockedPanelMaxWidth={maxWidth}>
          <div className="flex items-center justify-between bg-primary-150 border-b w-full rounded-t-lg px-2 h-10.5 ">
            {/* Status Dropdown and Search Bar */}
            <div className="w-full flex flex-1 justify-between overflow-x-auto no-scrollbar gap-2">
              <div className="flex flex-1 items-center gap-2">
                {displayTabs.length > 0 && (
                  <MailboxStatusDropdown
                    availableStatuses={displayTabs}
                    selectedStatus={activeStatusSlug}
                    onStatusChange={handleTabChange}
                  />
                )}

                <MailSearchBar
                  onSearch={handleSearch}
                  // Pass the non-deferred query for immediate display feedback in input
                  initialQuery={searchQuery}
                  isLoading={isListLoading} // Pass loading state from ThreadList
                />

                {/* Show pending actions badge in mail mode */}
              </div>
              <div className="flex items-center shrink-0 gap-2">
                <RadioTab
                  value={mode}
                  onValueChange={setMode}
                  size="sm"
                  className="border border-primary-200 bg-background/30">
                  <RadioTabItem value="mail" size="sm">
                    <MailIcon />
                    Mail
                  </RadioTabItem>
                  <RadioTabItem value="actions" size="sm">
                    <Play />
                    Actions
                  </RadioTabItem>
                </RadioTab>
              </div>
            </div>
          </div>
          {mode === 'actions' ? (
            // Actions mode: Show proposed actions view
            <div className="h-full flex-1 bg-secondary dark:bg-primary-100"></div>
          ) : (
            // Mail mode: Show regular mail interface
            <>
              {isSmallScreen ? (
                // Mobile: Single panel view based on URL state
                <div className="h-full flex-1 bg-secondary dark:bg-primary-100">
                  {selectedThreadId ? (
                    // Detail view: Show ThreadDisplay with back button
                    <div className="h-full flex flex-col">
                      <MobileThreadHeader onBack={handleBackToList} />
                      <div className="flex-1 overflow-hidden">
                        <ThreadDisplay />
                      </div>
                    </div>
                  ) : (
                    // List view: Show ThreadList
                    <div className="h-full overflow-hidden">
                      <ThreadList
                        filter={threadFilterForHook}
                        basePath={basePathForList}
                        selectedThreadId={selectedThreadId}
                        onLoadingChange={setIsListLoading}
                      />
                    </div>
                  )}
                </div>
              ) : (
                // Desktop: Keep existing ResizablePanelGroup
                <ResizablePanelGroup
                  direction="horizontal"
                  // Ensure the group fills the available height and prevents internal overflow issues
                  className="h-full  flex-1 grow overflow-hidden bg-secondary dark:bg-primary-100">
                  {/* Left Panel: Contains Tabs (if applicable), Search, and ThreadList */}
                  <ResizablePanel
                    defaultSize={defaultLayout[0]}
                    // minSize={20} // Minimum width for the list panel
                    // maxSize={40} // Maximum width for the list panel
                    collapsible={true}
                    className="flex flex-col overflow-y-hidden! border-none">
                    <div className="flex flex-1 flex-col items-stretch h-full">
                      <div className=" overflow-hidden flex-1 min-h-0">
                        <ThreadList
                          filter={threadFilterForHook} // Filter uses deferred search query
                          basePath={basePathForList}
                          selectedThreadId={selectedThreadId}
                          // Callback to receive loading state changes from ThreadList
                          onLoadingChange={setIsListLoading}
                        />
                      </div>
                    </div>
                  </ResizablePanel>

                  <ResizableHandle withHandle />

                  {/* Right Panel: Displays the selected thread details */}
                  <ResizablePanel defaultSize={defaultLayout[1]} minSize={30} collapsible>
                    <ThreadDisplay />
                  </ResizablePanel>
                </ResizablePanelGroup>
              )}
            </>
          )}
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
      </KeyboardProvider>
    </MailFilterProvider>
  )
}
