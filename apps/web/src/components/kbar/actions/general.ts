// apps/web/src/components/kbar/actions/general.ts
'use client'

import { useMemo } from 'react'
import { useComposeStore } from '~/components/mail/store/compose-store'
import { useCreateTaskStore } from '~/components/tasks/stores/create-task-store'
import { useCommandPaletteStore } from '../store'
import type { PaletteAction } from '../types'

/**
 * Top-of-palette quick actions that aren't navigation, create-entity, or theme:
 * compose a message and create a task. "Search records" is rendered separately
 * by the root page because it drills into a sub-page rather than running.
 */
export function useGeneralActions(): PaletteAction[] {
  return useMemo<PaletteAction[]>(
    () => [
      {
        id: 'compose',
        label: 'Compose',
        subtitle: 'Write a new message',
        icon: 'edit',
        keywords: 'compose write new email message',
        perform: () => {
          useComposeStore.getState().open({ mode: 'new', displayMode: 'floating' })
          useCommandPaletteStore.getState().close()
        },
      },
      {
        id: 'createTask',
        label: 'Create Task',
        subtitle: 'Create a new task',
        icon: 'list-checks',
        keywords: 'task create new to-do',
        perform: () => {
          useCreateTaskStore.getState().openDialog()
          useCommandPaletteStore.getState().close()
        },
      },
    ],
    []
  )
}
