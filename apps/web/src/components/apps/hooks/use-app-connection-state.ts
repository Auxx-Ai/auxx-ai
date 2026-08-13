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
  /**
   * Id of the credential the run will actually use — the node's own
   * `connectionId` when bound, otherwise the org's primary. Callers render this
   * as the picker's implicit selection so an unbound node shows what it uses.
   */
  id: string | null
}

const LOADING: AppConnectionInfo = {
  state: 'loading',
  requiresConnection: false,
  label: null,
  id: null,
}

/**
 * Resolve a node's connection state the same way the engine does at run time:
 * an explicit `connectionId` wins, otherwise the org's *primary* credential for
 * the app — `resolveAppConnectionForRuntime` bottoms out in `findCredential`,
 * which orders by `isDefault` then newest and takes one row. Nothing here may
 * accept a healthier credential than the one the run is going to get.
 *
 * Still fails open across users: `listConnections` returns every user's
 * credentials, so a user-scoped app somebody else connected can win the pick.
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
    return { state: 'not_required', requiresConnection: false, label: null, id: null }
  }

  // Bound: that row is the only candidate. A bound id with no row is a deleted
  // credential, which the engine cannot resolve either. Unbound: the org's
  // primary, newest as tiebreak — same order `findCredential` applies.
  const picked = connectionId
    ? appConnections.find((c) => c.id === connectionId)
    : appConnections
        .filter((c) => c.appId === appId)
        .sort(
          (a, b) =>
            Number(b.isDefault) - Number(a.isDefault) ||
            (b.connectedAt?.getTime() ?? 0) - (a.connectedAt?.getTime() ?? 0)
        )[0]

  if (!picked) return { state: 'missing', requiresConnection: true, label: null, id: null }
  return {
    state:
      picked.connectionStatus === 'connected'
        ? 'ok'
        : picked.connectionStatus === 'expired'
          ? 'expired'
          : 'missing',
    requiresConnection: true,
    label: picked.label ?? picked.appName ?? null,
    id: picked.id,
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
