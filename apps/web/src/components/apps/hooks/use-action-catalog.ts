// apps/web/src/components/apps/hooks/use-action-catalog.ts
'use client'

import {
  type ActionCatalogAppGroup,
  type ActionCatalogEntry,
  type ActionSurface,
  buildActionCatalog,
} from '@auxx/lib/quick-actions/client'
import { useMemo } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'

interface UseActionCatalogOptions {
  /**
   * Clamp the catalog to actions offered on this surface — `'email-editor'` for
   * the compose flow, `'ticket-header'` for the ticket header. Absent ⇒ every
   * surface.
   */
  surface?: ActionSurface
}

/**
 * Returns the org's quick actions, derived client-side from the installed-app
 * catalog's `actions` projection (via `useAppsContext` → `appInstallations`,
 * which already includes the synthetic auxx row). The actions analog of
 * `useToolCatalog`: one centralized source for every action render site, giving
 * both a flat list and an app-grouped view with the app icon resolved.
 */
export function useActionCatalog(options: UseActionCatalogOptions = {}): {
  actions: ActionCatalogEntry[]
  groups: ActionCatalogAppGroup[]
  isLoading: boolean
} {
  const { surface } = options
  const { appInstallations, isLoading } = useAppsContext()
  const { actions, groups } = useMemo(
    () => buildActionCatalog(appInstallations, { surface }),
    [appInstallations, surface]
  )
  return { actions, groups, isLoading }
}
