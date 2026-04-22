// apps/web/src/components/kbar/use-entity-create-actions.ts

import { type Action, useRegisterActions } from 'kbar'
import React from 'react'
import { useCreateEntityStore } from '~/components/global-create/create-entity-store'
import { useResources } from '~/components/resources/hooks/use-resources'

/**
 * Fixed system-entity hotkeys. Keep in sync with GlobalCreateRoot — these are
 * display-only here (kbar renders the kbd hint); the actual binding lives in
 * GlobalCreateRoot via useHotkeySequence.
 *
 * Custom entities do not get hotkeys in v1 — palette search only.
 */
const SYSTEM_CREATE_HOTKEYS: Record<string, string[]> = {
  contacts: ['c', 'c'],
  tickets: ['t', 'c'],
  parts: ['p', 'c'],
  companies: ['c', 'o'],
}

/**
 * Registers a "Create <Entity>" palette action for every visible resource
 * (system + custom). Derived from useResources() — adding a new entity
 * definition in the org automatically surfaces a new create action.
 */
export function useEntityCreateActions() {
  const { resources } = useResources()

  const actions = React.useMemo<Action[]>(() => {
    return resources
      .filter((r) => r.isVisible)
      .map((r) => ({
        id: `create-${r.id}`,
        name: `Create ${r.label}`,
        subtitle: `Create a new ${r.label.toLowerCase()}`,
        icon: r.icon,
        keywords: `create new ${r.label} ${r.plural}`.toLowerCase(),
        section: 'Create',
        shortcut: SYSTEM_CREATE_HOTKEYS[r.apiSlug],
        perform: () => useCreateEntityStore.getState().openDialog({ entityDefinitionId: r.id }),
      }))
  }, [resources])

  useRegisterActions(actions, [actions])
}
