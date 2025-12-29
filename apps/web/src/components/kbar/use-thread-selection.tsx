// File: ~/hooks/useThreadSelection.tsx
// --- START OF FILE ~/hooks/useThreadSelection.tsx ---
'use client' // Requires client hooks for state, effects, query client, and URL state

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createKeybindingsHandler, tinykeys } from 'tinykeys'
import { api, type RouterOutputs } from '~/trpc/react'
import { useQueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query' // Standalone utility to get query keys
import { toast } from 'sonner'
import { useThread } from '~/hooks/use-thread' // Hook for managing the single active thread ID
import { parseAsArrayOf, parseAsString, useQueryState } from 'nuqs' // Hook for managing state in URL query params
import useThreads from '~/hooks/use-threads-filter' // The hook to fetch threads based on a filter
import { useUser } from '~/hooks/use-user'
import { type ThreadsFilterInput } from '../mail/types'
// import type { ThreadsFilterInput } from '~/hooks/use-threads-filter' // Type definition for the filter

// Define the expected structure for items within the infinite query data pages
// Extracts the type of a single item from the 'items' array in the 'list' procedure output
type ThreadListItem = NonNullable<RouterOutputs['thread']['list']['items']>[number]

// Define the structure of the data returned by useInfiniteQuery for thread lists (TanStack Query v5 structure)
type InfiniteQueryData = {
  pages: {
    items: ThreadListItem[]
    nextCursor?: string | null // nextCursor is within each page object
  }[]
  pageParams: unknown[] // Array tracking the parameters used for each page fetch
}

/**
 * Hook to manage thread selection state (active thread, multi-selected threads)
 * and provide keyboard navigation/actions within the context of a specific thread list filter.
 * Relies on URL state ('selected' param) for multi-selection persistence.
 *
 * @param currentFilter - The current filter object (contextType, contextId, statusSlug, searchQuery)
 *                        being applied to the thread list this selection pertains to.
 *                        This is crucial for fetching the correct data and invalidating the correct queries.
 * @returns An object containing selection state, data, loading status, and action handlers.
 */
const useThreadSelection = (currentFilter: ThreadsFilterInput) => {
  // --- Core Hooks Setup ---
  const [activeThreadId, setActiveThreadId] = useThread() // State hook for the single *active* thread (for viewing details)

  // URL state for multi-selected thread IDs, synced with 'selected' query parameter
  const [selectedThreadIds, setSelectedThreadIds] = useQueryState(
    'selected',
    parseAsArrayOf(parseAsString).withDefault([]) // Default to empty array if param not present
  )

  // Local state for multi-selection mode toggle (e.g., triggered by 'm' key)
  const [isMultiSelecting, setIsMultiSelecting] = useState(false)

  // Fetch thread data using the useThreads hook (which likely uses useInfiniteQuery internally)
  // Pass the filter received as an argument to ensure context is correct
  const {
    data: infiniteQueryData, // Raw infinite query data: { pages: [...] }
    fetchNextPage, // Function to fetch the next page of results
    hasNextPage, // Boolean indicating if there's a next page to fetch
    isLoading, // Initial load state for the query
    isFetching, // Background fetching state (includes initial load and subsequent fetches)
    // refetch,              // Function to manually refetch the entire query if needed
  } = useThreads(currentFilter) // Pass the filter from the argument

  // --- Data Processing ---
  // Flatten the data from infinite query pages into a single, usable array
  // Memoized to prevent recalculation unless the raw data changes
  const data: ThreadListItem[] = useMemo(() => {
    return infiniteQueryData?.pages.flatMap((page) => page.items ?? []) ?? []
  }, [infiniteQueryData])

  /** Handles clicks on MailThreadItem for selection (single, toggle, range). */
  const handleThreadMultiSelect = useCallback(
    (threadId: string, event: React.MouseEvent) => {
      event.preventDefault() // Prevent potential default browser actions
      const currentData = data ?? [] // Use flattened thread list

      if (event.metaKey || event.ctrlKey) {
        // CMD/CTRL + Click: Toggle selection
        const newSelection = selectedThreadIds.includes(threadId)
          ? selectedThreadIds.filter((id) => id !== threadId) // Remove if present
          : [...selectedThreadIds, threadId] // Add if not present
        setSelectedThreadIds(newSelection)
        setActiveThreadId(threadId) // Set the clicked item as active
      } else if (event.shiftKey && activeThreadId && currentData.length > 0) {
        // SHIFT + Click: Range selection
        const clickedIndex = currentData.findIndex((t) => t.id === threadId)
        const activeIndex = currentData.findIndex((t) => t.id === activeThreadId) // Anchor point is the *active* thread

        if (clickedIndex !== -1 && activeIndex !== -1) {
          const start = Math.min(clickedIndex, activeIndex)
          const end = Math.max(clickedIndex, activeIndex)
          const rangeSelection = currentData.slice(start, end + 1).map((t) => t.id)
          setSelectedThreadIds(rangeSelection) // Replace current selection with the range
          setActiveThreadId(threadId) // Set the clicked item as active
        }
      } else {
        // Normal Click: Select only this item
        setSelectedThreadIds([threadId])
        setActiveThreadId(threadId)
      }
    },
    [selectedThreadIds, setSelectedThreadIds, activeThreadId, setActiveThreadId, data]
  ) // Dependencies

  /** Clears the multi-selection array. */
  const clearSelection = useCallback(() => {
    setSelectedThreadIds([])
  }, [setSelectedThreadIds])

  /** Selects all currently loaded threads in the list. */
  const selectAll = useCallback(() => {
    if (data && data.length > 0) {
      setSelectedThreadIds(data.map((t) => t.id))
    }
  }, [data, setSelectedThreadIds])

  /** Toggles the selection state of a single thread ID (e.g., for a checkbox). */
  const toggleThreadSelection = useCallback(
    (id: string) => {
      const newSelection = selectedThreadIds.includes(id)
        ? selectedThreadIds.filter((tid) => tid !== id)
        : [...selectedThreadIds, id]
      setSelectedThreadIds(newSelection)
      setActiveThreadId(id) // Make the toggled item active
    },
    [selectedThreadIds, setSelectedThreadIds, setActiveThreadId]
  )

  // --- Toast Notification for Selection Count ---
  // Shows a temporary toast when more than one item is selected.
  // const prevCountRef = useRef(selectedThreadIds.length)
  // useEffect(() => {
  //   const currentCount = selectedThreadIds.length
  //   // Show toast only when count > 1 and the count has changed
  //   if (currentCount > 1 && currentCount !== prevCountRef.current) {
  //     toast.info(`${currentCount} threads selected`, {
  //       id: 'selection-toast',
  //       duration: 2000,
  //       position: 'bottom-center',
  //     })
  //   } else if (currentCount <= 1 && prevCountRef.current > 1) {
  //     // Dismiss if count drops to 1 or 0
  //     toast.dismiss('selection-toast')
  //   }
  //   prevCountRef.current = currentCount // Update ref for next comparison
  // }, [selectedThreadIds])

  // --- Keyboard Navigation and Actions ---

  /** Memoized keyboard event handler using tinykeys. */
  const handler = useCallback(
    (event: KeyboardEvent) => {
      // Ignore keyboard events if focus is inside an input, textarea, select, or contenteditable element
      if (isInputElement(document.activeElement)) {
        return
      }

      const currentData = data ?? [] // Use flattened data for navigation

      // Helper to find the index of the currently active thread in the flattened list
      const findCurrentIndex = () => currentData.findIndex((t) => t.id === activeThreadId)

      /** Handles Arrow Up/Down navigation logic. */
      const handleArrow = (direction: 'up' | 'down') => {
        if (!currentData.length) return // Do nothing if list is empty

        let nextIndex = -1 // Initialize target index
        const currentIndex = findCurrentIndex()

        // Determine the next index based on direction and current position
        if (currentIndex === -1 && currentData.length > 0) {
          // No active thread, select first/last
          nextIndex = direction === 'down' ? 0 : currentData.length - 1
        } else if (direction === 'down' && currentIndex < currentData.length - 1) {
          // Move down
          nextIndex = currentIndex + 1
        } else if (direction === 'up' && currentIndex > 0) {
          // Move up
          nextIndex = currentIndex - 1
        }

        // Trigger fetch next page automatically if navigating near the end of loaded data
        if (
          direction === 'down' &&
          hasNextPage &&
          !isFetching &&
          currentData.length > 0 &&
          currentIndex >= currentData.length - 5
        ) {
          console.debug('Fetching next page due to keyboard nav near end...')
          fetchNextPage()
        }

        // If a valid next index was found, update state
        if (nextIndex !== -1) {
          const nextThread = currentData[nextIndex]
          if (nextThread) {
            setActiveThreadId(nextThread.id) // Update the active thread
            // Handle multi-selection based on Shift key
            if (event.shiftKey) {
              // Extend selection (add only, ensure uniqueness)
              setSelectedThreadIds((prev) => [...new Set([...prev, nextThread.id])])
            } else if (!isMultiSelecting) {
              // Default behavior (unless 'm' mode is on): Select only the focused item
              setSelectedThreadIds([nextThread.id])
            }
            // Optional: Scroll the item into view
            // Note: This is often better handled within the list component itself
            // document.getElementById(`thread-${nextThread.id}`)?.scrollIntoView({ block: 'nearest' });
          }
        }
      }

      // Define keybindings using tinykeys
      createKeybindingsHandler({
        ArrowDown: (e) => {
          e.preventDefault()
          handleArrow('down')
        },
        ArrowUp: (e) => {
          e.preventDefault()
          handleArrow('up')
        },
        Home: (e) => {
          e.preventDefault()
          if (currentData.length > 0 && currentData[0]) {
            setActiveThreadId(currentData[0].id)
            if (!event.shiftKey) setSelectedThreadIds([currentData[0].id])
          }
        },
        End: (e) => {
          e.preventDefault()
          if (currentData.length > 0 && currentData[currentData.length - 1]) {
            setActiveThreadId(currentData[currentData.length - 1].id)
            if (!event.shiftKey) setSelectedThreadIds([currentData[currentData.length - 1].id])
          }
        },
        Escape: (e) => {
          // Clear selection
          e.preventDefault()
          console.log('Escape pressed, clearing selection')
          // clearSelection()
        },
        // Select All (Cmd+A or Ctrl+A)
        'Meta+a': (event) => {
          console.log('Meta+a pressed, selecting all')
          event.preventDefault()
          selectAll()
        },
        'Control+a': (event) => {
          event.preventDefault()
          selectAll()
        },
        // Mark as Undone (Open)
        // Toggle Multi-Select Mode
        m: () => {
          setIsMultiSelecting((prev) => {
            const newState = !prev
            toast.info(newState ? 'Multi-select mode enabled' : 'Multi-select mode disabled')
            return newState
          })
        },
      })(event) // Invoke the handler with the event
    },
    [
      // List all dependencies for the keyboard handler
      activeThreadId,
      setActiveThreadId,
      selectedThreadIds,
      setSelectedThreadIds,
      isMultiSelecting,
      setIsMultiSelecting,
      data, // Depends on the flattened data array
      hasNextPage,
      isFetching,
      fetchNextPage,
      clearSelection,
      selectAll,
    ]
  )

  // Setup and cleanup keyboard event listeners
  useEffect(() => {
    window.addEventListener('keydown', handler)
    // Cleanup function to remove the listener when the component unmounts or handler changes
    return () => {
      window.removeEventListener('keydown', handler)
    }
  }, [handler]) // Effect runs only when the memoized handler function identity changes

  /** Helper function to check if the currently focused element is an input type. */
  const isInputElement = (element: Element | null): boolean => {
    if (!element) return false
    const tagName = element.tagName
    // Check common input tag names and the contentEditable attribute
    return (
      tagName === 'INPUT' ||
      tagName === 'TEXTAREA' ||
      tagName === 'SELECT' ||
      (element.hasAttribute('contenteditable') &&
        element.getAttribute('contenteditable') !== 'false')
    )
  }

  // --- Return Values ---
  // Expose the necessary state and functions for consuming components
  return {
    // State
    selectedThreads: selectedThreadIds, // Array of IDs selected for multi-action
    activeThreadId: activeThreadId, // Single ID of the focused/active thread for viewing details
    isMultiSelecting, // Boolean indicating if multi-select sticky mode is enabled

    // Actions / Handlers
    clearSelection, // Function to deselect all threads
    handleThreadMultiSelect, // Click handler for individual thread items
    setIsMultiSelecting, // Function to explicitly toggle multi-select mode
    toggleThreadSelection, // Function to toggle selection state of a single thread ID
    selectAll, // Function to select all currently loaded threads
    deselectAll: clearSelection, // Alias for clearSelection
    setActiveThreadId, // Function to programmatically set the active thread
    setSelectedThreadIds, // Function to directly set selected thread IDs

    // Data & Status (optional, useful for consumers needing direct access)
    threads: data, // The flattened list of currently loaded threads
    isLoading: isLoading || isFetching, // Combined loading indicator (initial load or background fetch)
  }
}

export default useThreadSelection
// --- END OF FILE ~/hooks/useThreadSelection.tsx ---
