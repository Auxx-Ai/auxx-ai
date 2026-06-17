// apps/web/src/components/kbar/contextual/use-record-actions.ts
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { useKopilotStore } from '~/components/kopilot/stores/kopilot-store'
import { useResourceStore } from '~/components/resources/store/resource-store'
import { recordHref } from '../record-href'
import { useCommandPaletteStore } from '../store'

/** The common record-action handler set, shared by the search-flow page and the
 * mounted-surface flow (`<RecordCommandActions>`) so the two can't drift. */
export interface RecordActionHandlers {
  /** Resolved detail-page href (relative), or `null` if unresolvable. */
  href: string | null
  /** Absolute href (origin-prefixed), or `null`. */
  absoluteHref: string | null
  /** Navigate to the record and close the palette. */
  open: () => void
  /** Open the record in a new tab and close the palette. */
  openNewTab: () => void
  /** Drill into the embedded create-task page, pre-linked to the record. */
  createTask: () => void
  /** Copy the record's display name. */
  copyName: () => void
  /** Copy the record's absolute link. */
  copyLink: () => void
  /** Open the Kopilot dock — the record is already in scope via its mounted context. */
  askKopilot: () => void
}

/**
 * Build the record-action handlers for a given record. Reads the resource store
 * for href resolution and drives both the command-palette store (navigation /
 * create-task) and the Kopilot store (dock).
 */
export function useRecordActions(recordId: string, displayName: string): RecordActionHandlers {
  const router = useRouter()
  const getResourceById = useResourceStore((s) => s.getResourceById)

  return useMemo(() => {
    const href = recordHref(recordId as RecordId, getResourceById)
    const absoluteHref =
      href && typeof window !== 'undefined' ? `${window.location.origin}${href}` : href

    const close = () => useCommandPaletteStore.getState().close()

    return {
      href,
      absoluteHref,
      open: () => {
        if (href) {
          router.push(href)
          close()
        }
      },
      openNewTab: () => {
        if (absoluteHref) window.open(absoluteHref, '_blank', 'noopener,noreferrer')
        close()
      },
      createTask: () => useCommandPaletteStore.getState().openCreateTask(recordId as RecordId),
      copyName: () => {
        void navigator.clipboard?.writeText(displayName)
        close()
      },
      copyLink: () => {
        if (absoluteHref) void navigator.clipboard?.writeText(absoluteHref)
        close()
      },
      askKopilot: () => {
        useKopilotStore.getState().setPanelOpen(true)
        close()
      },
    }
  }, [recordId, displayName, getResourceById, router])
}
