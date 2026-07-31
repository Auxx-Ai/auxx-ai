// apps/web/src/components/pickers/use-entity-list-nav.ts
'use client'

import { useRouter } from 'next/navigation'
import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useUnsavedChangesGuard } from '~/hooks/use-unsaved-changes-guard'
import type { EntitySwitcherItem } from './entity-switcher-list'

/** Copy overrides for the discard-changes confirm. */
export interface EntityNavConfirmOptions {
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
}

export interface EntityListNav {
  /** Position in display order, or -1 when the active entity is not in the list. */
  index: number
  hasPrev: boolean
  hasNext: boolean
  goPrev: () => void
  goNext: () => void
  /**
   * Wrap any other navigation the switcher owns — a row click — so it goes
   * through the same unsaved-changes confirm as prev/next.
   */
  guard: (run: () => void) => void
  /** Render inside the switcher; hosts the discard-changes confirm. */
  ConfirmDialog: React.FC
}

export interface UseEntityListNavInput {
  /** Display order, from `useEntitySwitcherOrder`. */
  ordered: EntitySwitcherItem[]
  activeId?: string
  /** The switcher's own select handler — nav navigates exactly like a row click. */
  onSelect: (item: EntitySwitcherItem) => void
  /**
   * Whether prev/next is mounted at all. `false` keeps the guard usable for row
   * clicks but costs nothing else — no prefetching for arrows that aren't there.
   */
  enabled?: boolean
  /** Disables both directions while the list query is in flight. */
  isLoading?: boolean
  /** Confirm before navigating away. No dialog when false/omitted. */
  isDirty?: boolean
  confirmOptions?: EntityNavConfirmOptions
}

/**
 * Prev/next over an entity switcher's displayed order.
 *
 * Navigation always goes through the caller's `onSelect`, so it inherits that
 * surface's routing (client-side `router.push` on every surface today) and its
 * slug-vs-id handling — nav never builds a URL of its own.
 *
 * There is no wrap-around: the ends disable, matching mail and records.
 */
export function useEntityListNav({
  ordered,
  activeId,
  onSelect,
  enabled = true,
  isLoading = false,
  isDirty = false,
  confirmOptions,
}: UseEntityListNavInput): EntityListNav {
  const router = useRouter()

  const index = useMemo(
    () => (activeId ? ordered.findIndex((item) => item.id === activeId) : -1),
    [ordered, activeId]
  )

  const prevItem = index > 0 ? ordered[index - 1] : undefined
  const nextItem = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : undefined

  const hasPrev = enabled && !isLoading && Boolean(prevItem)
  const hasNext = enabled && !isLoading && Boolean(nextItem)

  // The pending target for the guard. `useUnsavedChangesGuard` takes a single
  // `onConfirmedClose` callback, so the direction is stashed here rather than
  // rebuilding the guard per direction — which also keeps its re-entrancy lock
  // (one dialog for a held-down J) covering both.
  const pending = useRef<(() => void) | null>(null)

  const { guardedClose, ConfirmDialog } = useUnsavedChangesGuard({
    isDirty,
    onConfirmedClose: () => pending.current?.(),
    confirmOptions: {
      title: 'Discard changes?',
      description: 'You have unsaved changes. Leaving this page will discard them.',
      confirmText: 'Discard and leave',
      cancelText: 'Keep editing',
      ...confirmOptions,
    },
  })

  const guard = useCallback(
    (run: () => void) => {
      pending.current = run
      void guardedClose()
    },
    [guardedClose]
  )

  const goPrev = useCallback(() => {
    if (!hasPrev || !prevItem) return
    guard(() => onSelect(prevItem))
  }, [hasPrev, prevItem, guard, onSelect])

  const goNext = useCallback(() => {
    if (!hasNext || !nextItem) return
    guard(() => onSelect(nextItem))
  }, [hasNext, nextItem, guard, onSelect])

  // Warm both neighbours — every surface navigates with `router.push`, so the
  // route segment is the only thing standing between a keypress and the page.
  useEffect(() => {
    if (!enabled) return
    for (const href of [prevItem?.href, nextItem?.href]) {
      if (href) router.prefetch(href)
    }
  }, [enabled, router, prevItem?.href, nextItem?.href])

  return { index, hasPrev, hasNext, goPrev, goNext, guard, ConfirmDialog }
}
