// apps/web/src/components/apps/hooks/use-app-connection-state.ts
'use client'

import { useCallback } from 'react'
import {
  type AppConnection,
  type AppInstallation,
  useOptionalAppsContext,
} from '~/components/apps/providers/apps-context'

/**
 * Whether an app node can actually run against a connection.
 *
 * - `not_required` — the app declares no ConnectionDefinition; nothing to bind
 * - `loading`      — installations or connections are still in flight
 * - `ok`           — a usable (connected) credential resolves for this node
 * - `missing`      — the app needs a connection and none resolves
 * - `expired`      — a credential resolves but its refresh circuit is open / token expired
 */
export type AppConnectionState = 'not_required' | 'loading' | 'ok' | 'missing' | 'expired'

export interface AppConnectionInfo {
  state: AppConnectionState
  /** True when the app declares a user- or org-scoped ConnectionDefinition. */
  requiresConnection: boolean
  /** Label of the resolved credential, when one resolved. */
  label: string | null
}

const LOADING: AppConnectionInfo = { state: 'loading', requiresConnection: false, label: null }

/**
 * Resolve a node's connection state the same way the engine does at run time:
 * an explicit `connectionId` wins, otherwise any credential for the app (user-
 * or org-scoped) is a candidate — mirrors `resolveAppConnectionForRuntime`,
 * which falls back to whatever exists for the app when nothing is bound.
 *
 * Deliberately fails *open*: `listConnections` returns every user's credentials,
 * so a user-scoped app that somebody has connected reads as `ok` even though the
 * run's own user may not have connected. Only "nothing exists at all" is
 * reported as `missing`.
 */
export function deriveAppConnectionState({
  appId,
  connectionId,
  appInstallations,
  appConnections,
}: {
  appId: string | undefined
  connectionId: string | undefined
  appInstallations: AppInstallation[]
  appConnections: AppConnection[]
}): AppConnectionInfo {
  if (!appId) return LOADING

  const installation = appInstallations.find((i) => i.app.id === appId)
  const requiresConnection = !!(
    installation?.connectionDefinitions?.user || installation?.connectionDefinitions?.organization
  )

  if (!requiresConnection) {
    return { state: 'not_required', requiresConnection: false, label: null }
  }

  // Explicit binding: that row is the only candidate. A bound id with no row is
  // a deleted credential, which the engine cannot resolve either.
  if (connectionId) {
    const bound = appConnections.find((c) => c.id === connectionId)
    if (!bound) return { state: 'missing', requiresConnection: true, label: null }
    const label = bound.label ?? bound.appName ?? null
    if (bound.connectionStatus === 'connected') {
      return { state: 'ok', requiresConnection: true, label }
    }
    return {
      state: bound.connectionStatus === 'expired' ? 'expired' : 'missing',
      requiresConnection: true,
      label,
    }
  }

  // Unbound: any credential for the app can serve the run.
  const candidates = appConnections.filter((c) => c.appId === appId)
  if (candidates.length === 0) {
    return { state: 'missing', requiresConnection: true, label: null }
  }
  const usable = candidates.find((c) => c.connectionStatus === 'connected')
  if (usable) {
    return {
      state: 'ok',
      requiresConnection: true,
      label: usable.label ?? usable.appName ?? null,
    }
  }
  return {
    state: 'expired',
    requiresConnection: true,
    label: candidates[0]?.label ?? candidates[0]?.appName ?? null,
  }
}

/**
 * Returns a resolver over the current apps context. A function rather than a
 * value so callers that walk many nodes (the workflow checklist) resolve them
 * all from one context read.
 *
 * Returns `loading` for everything outside an `AppsContextProvider`, so shared
 * components can call it on pages with no apps infrastructure.
 */
export function useAppConnectionResolver(): (
  appId: string | undefined,
  connectionId: string | undefined
) => AppConnectionInfo {
  const context = useOptionalAppsContext()
  const { appInstallations, appConnections, isLoading, isLoadingConnections } = context ?? {}
  const unavailable = !context || isLoading || isLoadingConnections

  return useCallback(
    (appId, connectionId) => {
      if (unavailable) return LOADING
      return deriveAppConnectionState({
        appId,
        connectionId,
        appInstallations: appInstallations ?? [],
        appConnections: appConnections ?? [],
      })
    },
    [unavailable, appInstallations, appConnections]
  )
}
