// apps/web/src/components/mail/searchbar/store/search-store.ts
'use client'

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist } from 'zustand/middleware'
import type { FilterRef, SearchFilters } from '@auxx/lib/mail-query'

/**
 * Filter chip type for rendering badges in the search input.
 */
export interface FilterChip {
  /** Unique key for React */
  key: string
  /** Type: 'tag' | 'assignee' | 'inbox' | 'from' | 'to' | etc. */
  type: string
  /** Display label (e.g., "tag: urgent") */
  label: string
  /** For entity refs, the ID to pass to remove action */
  id?: string
  /** The actual value */
  value: string
}

/** Editing filter reference with type and index */
export interface EditingFilter {
  type: string
  index: number
}

interface SearchState {
  /** Core state - filters are the SINGLE SOURCE OF TRUTH */
  filters: SearchFilters

  /** Context scoping - filters are reset when context changes */
  contextKey: string | null

  /** UI state */
  isOpen: boolean
  showAdvanced: boolean

  /** Badge editing/highlight state for SearchFilterInput */
  editingFilter: EditingFilter | null
  highlightedBadgeIndex: number | null

  /** Persisted state */
  recentSearches: SearchFilters[]

  /** Tag actions */
  addTag: (tag: FilterRef) => void
  removeTag: (tagId: string) => void

  /** Assignee actions */
  addAssignee: (assignee: FilterRef) => void
  removeAssignee: (assigneeId: string) => void

  /** Inbox actions */
  addInbox: (inbox: FilterRef) => void
  removeInbox: (inboxId: string) => void

  /** Email participant actions */
  addFrom: (email: string) => void
  removeFrom: (email: string) => void
  addTo: (email: string) => void
  removeTo: (email: string) => void

  /** Text filter actions */
  setFreeText: (text: string) => void
  setSubject: (subject: string | undefined) => void
  setBody: (body: string | undefined) => void

  /** Status actions */
  toggleIs: (value: string) => void

  /** Property actions */
  setHasAttachments: (value: boolean | undefined) => void

  /** Date actions */
  setBefore: (date: Date | undefined) => void
  setAfter: (date: Date | undefined) => void

  /** Bulk actions */
  clearFilters: () => void
  setFilters: (filters: SearchFilters) => void
  setContext: (contextKey: string) => void

  /** UI actions */
  setOpen: (open: boolean) => void
  toggleAdvanced: () => void

  /** Badge editing actions */
  setEditingFilter: (filter: EditingFilter | null) => void
  setHighlightedBadgeIndex: (index: number | null) => void

  /** Generic filter actions for badge editing */
  updateFilterValue: (type: string, id: string, newValue: string) => void
  removeFilter: (type: string, id: string) => void

  /** Recent searches */
  saveToRecent: () => void
  clearRecentSearches: () => void
}

/** Stable empty reference to prevent re-renders */
const INITIAL_FILTERS: SearchFilters = {}

/** Stable empty chips array */
export const EMPTY_CHIPS: FilterChip[] = []

/** Filter field keys for DRY iteration */
const REF_FILTER_KEYS = ['tags', 'assignees', 'inboxes'] as const
const STRING_ARRAY_KEYS = ['from', 'to'] as const
const SINGLE_STRING_KEYS = ['freeText', 'subject', 'body'] as const
const BOOL_FILTER_KEYS = ['hasAttachments'] as const
const DATE_FILTER_KEYS = ['before', 'after'] as const

type RefFilterKey = (typeof REF_FILTER_KEYS)[number]
type StringArrayKey = (typeof STRING_ARRAY_KEYS)[number]

/**
 * Helper to create add/remove actions for FilterRef arrays.
 */
function createRefActions(
  set: (fn: (state: SearchState) => void) => void,
  key: RefFilterKey
) {
  return {
    add: (ref: FilterRef) =>
      set((state) => {
        if (!state.filters[key]) state.filters[key] = []
        if (!state.filters[key]!.some((r) => r.id === ref.id)) {
          state.filters[key]!.push(ref)
        }
      }),
    remove: (id: string) =>
      set((state) => {
        state.filters[key] = state.filters[key]?.filter((r) => r.id !== id)
        if (!state.filters[key]?.length) state.filters[key] = undefined
      }),
  }
}

/**
 * Helper to create add/remove actions for string arrays.
 */
function createStringArrayActions(
  set: (fn: (state: SearchState) => void) => void,
  key: StringArrayKey
) {
  return {
    add: (value: string) =>
      set((state) => {
        if (!state.filters[key]) state.filters[key] = []
        if (!state.filters[key]!.includes(value)) {
          state.filters[key]!.push(value)
        }
      }),
    remove: (value: string) =>
      set((state) => {
        state.filters[key] = state.filters[key]?.filter((v) => v !== value)
        if (!state.filters[key]?.length) state.filters[key] = undefined
      }),
  }
}

export const useSearchStore = create<SearchState>()(
  persist(
    immer((set) => {
      // Create generic actions using helpers
      const tagActions = createRefActions(set, 'tags')
      const assigneeActions = createRefActions(set, 'assignees')
      const inboxActions = createRefActions(set, 'inboxes')
      const fromActions = createStringArrayActions(set, 'from')
      const toActions = createStringArrayActions(set, 'to')

      return {
        // Core state
        filters: INITIAL_FILTERS,

        // Context scoping
        contextKey: null,

        // UI state
        isOpen: false,
        showAdvanced: false,

        // Badge editing/highlight state
        editingFilter: null,
        highlightedBadgeIndex: null,

        // Persisted state
        recentSearches: [],

        // Entity actions (using generic helpers)
        addTag: tagActions.add,
        removeTag: tagActions.remove,
        addAssignee: assigneeActions.add,
        removeAssignee: assigneeActions.remove,
        addInbox: inboxActions.add,
        removeInbox: inboxActions.remove,
        addFrom: fromActions.add,
        removeFrom: fromActions.remove,
        addTo: toActions.add,
        removeTo: toActions.remove,

        // Text filter actions
        setFreeText: (text) =>
          set((state) => {
            state.filters.freeText = text || undefined
          }),
        setSubject: (subject) =>
          set((state) => {
            state.filters.subject = subject
          }),
        setBody: (body) =>
          set((state) => {
            state.filters.body = body
          }),

        // Status actions - toggle pattern for multiple values
        toggleIs: (value) =>
          set((state) => {
            if (!state.filters.is) state.filters.is = []
            const index = state.filters.is.indexOf(value)
            if (index === -1) {
              state.filters.is.push(value)
            } else {
              state.filters.is.splice(index, 1)
            }
            if (!state.filters.is.length) state.filters.is = undefined
          }),

        // Property actions
        setHasAttachments: (value) =>
          set((state) => {
            state.filters.hasAttachments = value
          }),

        // Date actions - separate to allow both before and after
        setBefore: (date) =>
          set((state) => {
            state.filters.before = date
          }),
        setAfter: (date) =>
          set((state) => {
            state.filters.after = date
          }),

        // Bulk actions
        clearFilters: () =>
          set((state) => {
            state.filters = { ...INITIAL_FILTERS }
          }),

        setFilters: (filters) =>
          set((state) => {
            state.filters = filters
          }),

        // Context scoping - reset filters when switching contexts
        setContext: (contextKey) =>
          set((state) => {
            if (state.contextKey !== contextKey) {
              state.contextKey = contextKey
              state.filters = { ...INITIAL_FILTERS }
              state.isOpen = false
              state.showAdvanced = false
              state.editingFilter = null
              state.highlightedBadgeIndex = null
            }
          }),

        // UI actions
        setOpen: (open) =>
          set((state) => {
            state.isOpen = open
            if (!open) {
              state.showAdvanced = false
              state.editingFilter = null
              state.highlightedBadgeIndex = null
            }
          }),

        toggleAdvanced: () =>
          set((state) => {
            state.showAdvanced = !state.showAdvanced
          }),

        // Badge editing actions
        setEditingFilter: (filter) =>
          set((state) => {
            state.editingFilter = filter
            state.highlightedBadgeIndex = null
          }),

        setHighlightedBadgeIndex: (index) =>
          set((state) => {
            state.highlightedBadgeIndex = index
          }),

        // Generic filter actions for badge editing
        updateFilterValue: (type, id, newValue) =>
          set((state) => {
            switch (type) {
              case 'tag':
                if (state.filters.tags) {
                  const tag = state.filters.tags.find((t) => t.id === id)
                  if (tag) tag.name = newValue
                }
                break
              case 'assignee':
                if (state.filters.assignees) {
                  const assignee = state.filters.assignees.find((a) => a.id === id)
                  if (assignee) assignee.name = newValue
                }
                break
              case 'inbox':
                if (state.filters.inboxes) {
                  const inbox = state.filters.inboxes.find((i) => i.id === id)
                  if (inbox) inbox.name = newValue
                }
                break
              case 'from':
                if (state.filters.from) {
                  const idx = state.filters.from.indexOf(id)
                  if (idx !== -1) state.filters.from[idx] = newValue
                }
                break
              case 'to':
                if (state.filters.to) {
                  const idx = state.filters.to.indexOf(id)
                  if (idx !== -1) state.filters.to[idx] = newValue
                }
                break
              case 'subject':
                state.filters.subject = newValue || undefined
                break
              case 'body':
                state.filters.body = newValue || undefined
                break
            }
          }),

        removeFilter: (type, id) =>
          set((state) => {
            switch (type) {
              case 'tag':
                state.filters.tags = state.filters.tags?.filter((t) => t.id !== id)
                if (!state.filters.tags?.length) state.filters.tags = undefined
                break
              case 'assignee':
                state.filters.assignees = state.filters.assignees?.filter((a) => a.id !== id)
                if (!state.filters.assignees?.length) state.filters.assignees = undefined
                break
              case 'inbox':
                state.filters.inboxes = state.filters.inboxes?.filter((i) => i.id !== id)
                if (!state.filters.inboxes?.length) state.filters.inboxes = undefined
                break
              case 'from':
                state.filters.from = state.filters.from?.filter((e) => e !== id)
                if (!state.filters.from?.length) state.filters.from = undefined
                break
              case 'to':
                state.filters.to = state.filters.to?.filter((e) => e !== id)
                if (!state.filters.to?.length) state.filters.to = undefined
                break
              case 'subject':
                state.filters.subject = undefined
                break
              case 'body':
                state.filters.body = undefined
                break
              case 'is':
                state.filters.is = state.filters.is?.filter((s) => s !== id)
                if (!state.filters.is?.length) state.filters.is = undefined
                break
              case 'has':
                if (id === 'attachments') state.filters.hasAttachments = undefined
                break
              case 'before':
                state.filters.before = undefined
                break
              case 'after':
                state.filters.after = undefined
                break
            }
          }),

        // Recent searches
        saveToRecent: () =>
          set((state) => {
            const current = state.filters
            // Check if there are active filters
            const hasFilters = !!(
              current.freeText ||
              current.from?.length ||
              current.to?.length ||
              current.tags?.length ||
              current.assignees?.length ||
              current.inboxes?.length ||
              current.subject ||
              current.body ||
              current.is?.length ||
              current.hasAttachments ||
              current.before ||
              current.after
            )
            if (!hasFilters) return

            // Deep clone with Date handling
            const clone = JSON.parse(JSON.stringify(current), (key, value) => {
              if (key === 'before' || key === 'after') {
                return value ? new Date(value) : undefined
              }
              return value
            }) as SearchFilters

            // Remove duplicates and limit to 10
            const isDuplicate = (a: SearchFilters, b: SearchFilters) =>
              JSON.stringify(a) === JSON.stringify(b)

            state.recentSearches = [
              clone,
              ...state.recentSearches.filter((r) => !isDuplicate(r, clone)),
            ].slice(0, 10)
          }),

        clearRecentSearches: () =>
          set((state) => {
            state.recentSearches = []
          }),
      }
    }),
    {
      name: 'mail-search-store',
      partialize: (state) => ({
        recentSearches: state.recentSearches,
      }),
      // Custom storage to handle Date objects
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name)
          if (!str) return null
          return JSON.parse(str, (key, value) => {
            // Revive Date fields in recentSearches
            if ((key === 'before' || key === 'after') && value) {
              return new Date(value)
            }
            return value
          })
        },
        setItem: (name, value) => {
          localStorage.setItem(name, JSON.stringify(value))
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
)

// ============================================================================
// Selectors
// ============================================================================

/**
 * Check if any filters are currently active.
 */
export const selectHasActiveFilters = (state: SearchState): boolean => {
  const f = state.filters
  return (
    REF_FILTER_KEYS.some((k) => f[k]?.length) ||
    STRING_ARRAY_KEYS.some((k) => f[k]?.length) ||
    SINGLE_STRING_KEYS.some((k) => f[k]) ||
    BOOL_FILTER_KEYS.some((k) => f[k]) ||
    DATE_FILTER_KEYS.some((k) => f[k]) ||
    !!(f.is?.length)
  )
}

/**
 * Count the number of active filters.
 */
export const selectActiveFilterCount = (state: SearchState): number => {
  const f = state.filters
  let count = 0
  REF_FILTER_KEYS.forEach((k) => {
    count += f[k]?.length ?? 0
  })
  STRING_ARRAY_KEYS.forEach((k) => {
    count += f[k]?.length ?? 0
  })
  SINGLE_STRING_KEYS.forEach((k) => {
    if (f[k]) count++
  })
  BOOL_FILTER_KEYS.forEach((k) => {
    if (f[k]) count++
  })
  DATE_FILTER_KEYS.forEach((k) => {
    if (f[k]) count++
  })
  if (f.is?.length) count += f.is.length
  return count
}

/**
 * Generate display text from filters (for showing in collapsed search bar).
 */
export const selectDisplayText = (state: SearchState): string => {
  const f = state.filters
  const parts: string[] = []

  f.tags?.forEach((t) => parts.push(`tag:${t.name}`))
  f.assignees?.forEach((a) => parts.push(`assignee:${a.name}`))
  f.inboxes?.forEach((i) => parts.push(`inbox:${i.name}`))
  f.from?.forEach((e) => parts.push(`from:${e}`))
  f.to?.forEach((e) => parts.push(`to:${e}`))
  if (f.subject) parts.push(`subject:${f.subject}`)
  if (f.body) parts.push(`body:${f.body}`)
  f.is?.forEach((s) => parts.push(`is:${s}`))
  if (f.hasAttachments) parts.push('has:attachments')
  if (f.before) parts.push(`before:${f.before.toISOString().split('T')[0]}`)
  if (f.after) parts.push(`after:${f.after.toISOString().split('T')[0]}`)
  if (f.freeText) parts.push(f.freeText)

  return parts.join(' ')
}

// ============================================================================
// Chip Builder
// ============================================================================

/** Chip configuration - define once, use everywhere */
const CHIP_CONFIG = {
  tags: {
    type: 'tag',
    getKey: (t: FilterRef) => `tag-${t.id}`,
    getLabel: (t: FilterRef) => `tag: ${t.name}`,
  },
  assignees: {
    type: 'assignee',
    getKey: (a: FilterRef) => `assignee-${a.id}`,
    getLabel: (a: FilterRef) => `assignee: ${a.name}`,
  },
  inboxes: {
    type: 'inbox',
    getKey: (i: FilterRef) => `inbox-${i.id}`,
    getLabel: (i: FilterRef) => `inbox: ${i.name}`,
  },
  from: {
    type: 'from',
    getKey: (e: string) => `from-${e}`,
    getLabel: (e: string) => `from: ${e}`,
  },
  to: {
    type: 'to',
    getKey: (e: string) => `to-${e}`,
    getLabel: (e: string) => `to: ${e}`,
  },
  is: {
    type: 'is',
    getKey: (s: string) => `is-${s}`,
    getLabel: (s: string) => `is: ${s}`,
  },
} as const

/**
 * Build filter chips from filters object.
 * Exported for reuse in both store selector and hooks.
 */
export function buildFilterChips(filters: SearchFilters): FilterChip[] {
  const chips: FilterChip[] = []

  // Handle entity refs
  for (const key of REF_FILTER_KEYS) {
    const config = CHIP_CONFIG[key]
    filters[key]?.forEach((item) => {
      chips.push({
        key: config.getKey(item),
        type: config.type,
        label: config.getLabel(item),
        id: item.id,
        value: item.name,
      })
    })
  }

  // Handle string arrays (from, to)
  for (const key of STRING_ARRAY_KEYS) {
    const config = CHIP_CONFIG[key]
    filters[key]?.forEach((value) => {
      chips.push({
        key: config.getKey(value),
        type: config.type,
        label: config.getLabel(value),
        value,
      })
    })
  }

  // Handle is: array
  filters.is?.forEach((s) => {
    chips.push({ key: `is-${s}`, type: 'is', label: `is: ${s}`, value: s })
  })

  // Handle single-value fields
  if (filters.subject) {
    chips.push({
      key: 'subject',
      type: 'subject',
      label: `subject: ${filters.subject}`,
      value: filters.subject,
    })
  }
  if (filters.body) {
    chips.push({
      key: 'body',
      type: 'body',
      label: `body: ${filters.body}`,
      value: filters.body,
    })
  }

  // Handle special fields
  if (filters.hasAttachments) {
    chips.push({
      key: 'has-attachments',
      type: 'has',
      label: 'has: attachments',
      value: 'attachments',
    })
  }
  if (filters.before) {
    chips.push({
      key: 'before',
      type: 'before',
      label: `before: ${filters.before.toISOString().split('T')[0]}`,
      value: filters.before.toISOString(),
    })
  }
  if (filters.after) {
    chips.push({
      key: 'after',
      type: 'after',
      label: `after: ${filters.after.toISOString().split('T')[0]}`,
      value: filters.after.toISOString(),
    })
  }

  return chips
}

/**
 * WARNING: This selector creates new array/objects on every call.
 * DO NOT use directly in components - use useFilterChips() hook instead.
 */
export const selectFilterChipsRaw = (state: SearchState): FilterChip[] => {
  if (!selectHasActiveFilters(state)) return EMPTY_CHIPS
  return buildFilterChips(state.filters)
}
