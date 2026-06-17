// apps/web/src/components/apps/hooks/use-bound-credential.ts
'use client'

import { useMemo } from 'react'
import { type AppConnection, useAppsContext } from '~/components/apps/providers/apps-context'

/**
 * Status of an agent's bound credential. Derived from
 * `useAppsContext().appConnections` so every callsite gets the same
 * answer with no extra queries. See
 * plans/kopilot/apps/agent-credentials.md §3.3.
 *
 * - `unbound`   — no binding has been set on the agent yet (credId undefined)
 * - `gone`      — credId set but the Credential row is missing
 * - `connected` — row exists and `connectionStatus === 'connected'`
 * - `expired`   — row exists and `connectionStatus === 'expired'`
 * - `not_connected` — row exists but never authenticated (rare path)
 */
export type BoundCredentialStatus = 'connected' | 'expired' | 'not_connected' | 'gone' | 'unbound'

export interface BoundCredential {
  status: BoundCredentialStatus
  label: string | null
  scope: 'workspace' | 'personal' | null
  /** `connectedBy` from the underlying row — populated for personal creds. */
  connectedBy: string | null
  /** Raw row for callers needing more (expiresAt, appInstallationId, …). */
  connection: AppConnection | null
}

export function useBoundCredential(credId: string | undefined | null): BoundCredential {
  const { appConnections } = useAppsContext()

  return useMemo(() => {
    if (!credId) {
      return { status: 'unbound', label: null, scope: null, connectedBy: null, connection: null }
    }
    const row = appConnections.find((c) => c.id === credId) ?? null
    if (!row) {
      return { status: 'gone', label: null, scope: null, connectedBy: null, connection: null }
    }
    const status = (row.connectionStatus as BoundCredentialStatus) ?? 'not_connected'
    return {
      status,
      label: row.label ?? row.appName ?? null,
      scope: row.global ? 'workspace' : 'personal',
      connectedBy: row.connectedBy ?? null,
      connection: row,
    }
  }, [credId, appConnections])
}
