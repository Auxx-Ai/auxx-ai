// apps/web/src/components/kbar/actions/general.ts
'use client'

import { useMemo } from 'react'
import { useComposeStore } from '~/components/mail/store/compose-store'
import { useAccess } from '~/providers/capabilities-provider'
import { useCommandPaletteStore } from '../store'
import type { PaletteAction } from '../types'

/**
 * Top-of-palette quick actions that aren't navigation, create-entity, or theme:
 * compose a message and create a task. "Search records" is rendered separately
 * by the root page because it drills into a sub-page rather than running.
 */
export function useGeneralActions(): PaletteAction[] {
  const { can } = useAccess()
  const canCompose = can('inboxes.view')

  return useMemo<PaletteAction[]>(
    () => [
      // Compose needs somewhere to send FROM, and the From picker reads the
      // channel store — which a member without mail access no longer populates.
      // Offering the action anyway opens a composer that cannot send.
      ...(canCompose
        ? [
            {
              id: 'compose',
              label: 'Compose',
              subtitle: 'Write a new message',
              icon: 'edit' as const,
              keywords: 'compose write new email message',
              perform: () => {
                useComposeStore.getState().open({ mode: 'new', displayMode: 'floating' })
                useCommandPaletteStore.getState().close()
              },
            },
          ]
        : []),
      {
        id: 'createTask',
        label: 'Create Task',
        subtitle: 'Create a new task',
        icon: 'list-checks',
        keywords: 'task create new to-do',
        perform: () => useCommandPaletteStore.getState().openCreateTask(),
      },
    ],
    [canCompose]
  )
}
