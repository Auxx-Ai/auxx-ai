// apps/web/src/components/kbar/actions/create.ts
'use client'

import { useMemo } from 'react'
import { useCreateEntityStore } from '~/components/global-create/create-entity-store'
import { SYSTEM_CREATE_HOTKEYS } from '~/components/global-create/system-hotkeys'
import { useResources } from '~/components/resources/hooks/use-resources'
import { useSignatureDialogStore } from '~/components/signatures/stores/signature-dialog-store'
import { useSnippetDialogStore } from '~/components/snippets/snippet-dialog-store'
import { useCommandPaletteStore } from '../store'
import type { PaletteAction } from '../types'

/**
 * "Create <Entity>" actions, one per visible resource (system + custom). Inside
 * the palette these drill into the embedded `create` page; the create chords
 * themselves (`c,c` etc.) stay owned by global-create — here they're only shown
 * as hints (sourced from {@link SYSTEM_CREATE_HOTKEYS}).
 */
export function useCreateActions(): PaletteAction[] {
  const { resources } = useResources()

  return useMemo<PaletteAction[]>(() => {
    return resources
      .filter((r) => r.isVisible)
      .map((r) => ({
        id: `create.${r.id}`,
        label: `Create ${r.label}`,
        subtitle: `Create a new ${r.label.toLowerCase()}`,
        icon: r.icon,
        keywords: `create new ${r.label} ${r.plural}`.toLowerCase(),
        shortcut: SYSTEM_CREATE_HOTKEYS[r.apiSlug],
        // Inside the palette, render the create form as a step (Phase 3).
        perform: () => useCommandPaletteStore.getState().openCreate(r.id),
      }))
  }, [resources])
}

/**
 * Create actions that aren't entity instances — signatures and snippets — each
 * driven by its own global dialog store ({@link useSignatureDialogStore} /
 * {@link useSnippetDialogStore}). Kept out of the resource loop above since they
 * have no entity definition.
 */
export function useNonEntityCreateActions(): PaletteAction[] {
  return useMemo<PaletteAction[]>(
    () => [
      {
        id: 'create.signature',
        label: 'Create Signature',
        subtitle: 'New email signature',
        icon: 'pen-tool',
        keywords: 'create new signature email',
        perform: () => {
          useSignatureDialogStore.getState().openCreate()
          useCommandPaletteStore.getState().close()
        },
      },
      {
        id: 'create.snippet',
        label: 'Create Snippet',
        subtitle: 'New reusable snippet',
        icon: 'braces',
        keywords: 'create new snippet canned response',
        perform: () => {
          useSnippetDialogStore.getState().openCreate()
          useCommandPaletteStore.getState().close()
        },
      },
    ],
    []
  )
}

/**
 * Standalone create launcher used outside the palette (the global-create store).
 * Kept separate so the palette `perform` can stay embedded while record-table
 * "+ New" and the `c,*` hotkeys keep popping the standalone dialog.
 */
export function openStandaloneCreate(entityDefinitionId: string): void {
  useCreateEntityStore.getState().openDialog({ entityDefinitionId })
}
