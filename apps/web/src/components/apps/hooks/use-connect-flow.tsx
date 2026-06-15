// apps/web/src/components/apps/hooks/use-connect-flow.tsx

'use client'

import type { ConnectionVariable } from '@auxx/database'
import { toastError } from '@auxx/ui/components/toast'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '~/trpc/react'
import { ConnectionVariableForm } from '../ui/connection-variable-form'
import { SecretConnectionForm } from '../ui/secret-connection-form'

interface OAuthDonePayload {
  type: 'oauth_done'
  ok: boolean
  credId?: string | null
  appId?: string | null
  error?: string | null
}

type Scope = 'user' | 'organization'

/**
 * Connection-definition fields useConnectFlow actually reads. Both the
 * settings-dialog (`AppData` from `apps.getBySlug`) and the picker
 * (`AppInstallation` from `apps.listInstalled`) carry these fields; this
 * narrow shape lets either source feed the hook without an adapter on
 * the consumer side.
 */
export interface ConnectFlowDefinition {
  connectionType: string
  description?: string | null
  connectionVariables?: ConnectionVariable[] | null
}

export interface ConnectTarget {
  appId: string
  appSlug: string
  appTitle: string
  installationId: string
  connectionDefinitions: {
    user?: ConnectFlowDefinition | null
    organization?: ConnectFlowDefinition | null
  }
}

export interface ConnectFlowArgs {
  target: ConnectTarget
  scope: Scope
  /** Existing credId when reconnecting; absent for fresh connects. */
  connectionId?: string
  /**
   * Plain connection-variable values to prefill the variable form on reconnect.
   * Secret-flagged values are never prefilled — the admin re-enters them.
   */
  prefillVariables?: Record<string, string>
  /** Optional return URL for full-redirect fallback. */
  returnTo?: string
}

export interface UseConnectFlow {
  start: (args: ConnectFlowArgs) => void
  /** Renders any dialog the hook owns (variable, secret). Mount once per caller. */
  Dialogs: ReactNode
  pending: boolean
  lastConnectedCredId: string | null
  error: Error | null
}

export interface UseConnectFlowOptions {
  /**
   * Connect strategy. `popup` opens a popup window and listens for
   * `postMessage` / `BroadcastChannel`; `redirect` uses
   * `window.location.href` and wipes editor state. Default is `popup`;
   * the hook automatically falls back to `redirect` when `window.open`
   * is blocked.
   */
  mode?: 'redirect' | 'popup'
  /** Fired when a connect attempt produces a new credId. */
  onConnected?: (credId: string, args: ConnectFlowArgs) => void
}

/**
 * Single entry point for "start a connect attempt for app X in scope Y".
 * Absorbs the inline branching from the legacy `AppConnections` flow.
 * See plans/kopilot/apps/app-settings-dialog-refactor.md §3.
 */
export function useConnectFlow(options: UseConnectFlowOptions = {}): UseConnectFlow {
  const { onConnected, mode = 'popup' } = options
  const utils = api.useUtils()

  const [args, setArgs] = useState<ConnectFlowArgs | null>(null)
  const [secretOpen, setSecretOpen] = useState(false)
  const [variableOpen, setVariableOpen] = useState(false)
  const [oauthPending, setOauthPending] = useState(false)
  const [lastConnectedCredId, setLastConnectedCredId] = useState<string | null>(null)
  const [error, setError] = useState<Error | null>(null)

  // Tear-down for the active popup listener set (message handler,
  // BroadcastChannel, popup-closed interval). Set when a popup flow starts;
  // invoked when the flow completes, is cancelled, or the hook unmounts.
  const teardownRef = useRef<(() => void) | null>(null)
  const teardown = useCallback(() => {
    teardownRef.current?.()
    teardownRef.current = null
  }, [])
  useEffect(() => () => teardown(), [teardown])

  // Reconnect first tries a silent OAuth refresh (see attemptRefreshThenOAuth); an app
  // connection is just a credential, so it reuses the credentials refresh mutation.
  const refreshConnection = api.credentials.refreshOAuthTokens.useMutation()

  const saveSecret = api.apps.saveSecretConnection.useMutation({
    onSuccess: (data) => {
      setSecretOpen(false)
      setVariableOpen(false)
      void utils.apps.listConnections.invalidate()
      void utils.apps.listInstalled.invalidate()
      const credId = data?.credentialId ?? null
      if (credId) {
        setLastConnectedCredId(credId)
        if (args) onConnected?.(credId, args)
      }
      setArgs(null)
    },
    onError: (err) => {
      setError(err instanceof Error ? err : new Error(err.message))
      toastError({ title: 'Failed to save connection', description: err.message })
    },
  })

  const kickOauth = useCallback(
    (a: ConnectFlowArgs, vars: Record<string, string> = {}) => {
      const params = new URLSearchParams()
      params.set('installation', a.target.installationId)
      params.set('type', a.scope)
      if (a.connectionId) params.set('connectionId', a.connectionId)
      if (a.returnTo) params.set('returnTo', a.returnTo)
      for (const [key, value] of Object.entries(vars)) {
        if (value) params.set(`var_${key}`, value)
      }
      const baseUrl = `/api/apps/${a.target.appSlug}/oauth2/authorize`

      if (mode === 'redirect') {
        window.location.href = `${baseUrl}?${params}`
        return
      }

      // Popup mode — open the authorize URL with mode=popup and listen for
      // the termination message from the server-rendered callback page.
      const popupParams = new URLSearchParams(params)
      popupParams.set('mode', 'popup')
      const popup = window.open(
        `${baseUrl}?${popupParams}`,
        'auxx-oauth',
        'popup=yes,width=600,height=720'
      )
      if (!popup) {
        // Popup blocker engaged — fall back to full-page redirect.
        window.location.href = `${baseUrl}?${params}`
        return
      }

      // Replace any prior listener set from an earlier attempt.
      teardown()
      setOauthPending(true)

      const handleDone = (payload: OAuthDonePayload) => {
        teardown()
        void utils.apps.listConnections.invalidate()
        void utils.apps.listInstalled.invalidate()
        if (payload.ok && payload.credId) {
          setLastConnectedCredId(payload.credId)
          onConnected?.(payload.credId, a)
        } else if (!payload.ok) {
          const message = payload.error || 'Connection failed'
          setError(new Error(message))
          toastError({ title: 'Failed to connect', description: message })
        }
      }

      const onMessage = (e: MessageEvent) => {
        // The callback page may live on a different origin in dev (NGROK_URL tunnel), so also
        // trust messages coming from the popup window we opened ourselves.
        if (e.source !== popup && e.origin !== window.location.origin) return
        if (!e.data || e.data.type !== 'oauth_done') return
        handleDone(e.data as OAuthDonePayload)
      }
      window.addEventListener('message', onMessage)

      let bc: BroadcastChannel | null = null
      try {
        bc = new BroadcastChannel('oauth-app-connect')
        bc.onmessage = (e) => {
          if (!e.data || e.data.type !== 'oauth_done') return
          handleDone(e.data as OAuthDonePayload)
        }
      } catch {
        // BroadcastChannel unavailable — postMessage path still works.
      }

      const closedInterval = setInterval(() => {
        if (popup.closed) teardown()
      }, 500)

      teardownRef.current = () => {
        window.removeEventListener('message', onMessage)
        bc?.close()
        clearInterval(closedInterval)
        try {
          if (!popup.closed) popup.close()
        } catch {
          // ignore
        }
        setOauthPending(false)
        setArgs(null)
      }
    },
    [mode, onConnected, teardown, utils.apps.listConnections, utils.apps.listInstalled]
  )

  // Reconnect path: try a silent refresh-token exchange before the full OAuth popup.
  // When the refresh token is still valid (e.g. the access token merely lapsed while the
  // dev server was down) this renews the connection — and resets the expiry circuit
  // breaker server-side — without any user interaction. Only when the refresh fails
  // (revoked / no refresh token) do we fall back to the full OAuth flow.
  const attemptRefreshThenOAuth = useCallback(
    async (a: ConnectFlowArgs) => {
      if (!a.connectionId) {
        kickOauth(a)
        return
      }
      setOauthPending(true)
      try {
        await refreshConnection.mutateAsync({ credentialId: a.connectionId })
        void utils.apps.listConnections.invalidate()
        void utils.apps.listInstalled.invalidate()
        setOauthPending(false)
        setLastConnectedCredId(a.connectionId)
        onConnected?.(a.connectionId, a)
        setArgs(null)
      } catch {
        // Refresh unavailable — fall back to the full OAuth re-authorization.
        setOauthPending(false)
        kickOauth(a)
      }
    },
    [
      kickOauth,
      refreshConnection,
      onConnected,
      utils.apps.listConnections,
      utils.apps.listInstalled,
    ]
  )

  const start = useCallback(
    (next: ConnectFlowArgs) => {
      setError(null)
      const def =
        next.scope === 'user'
          ? next.target.connectionDefinitions?.user
          : next.target.connectionDefinitions?.organization
      if (!def) {
        setError(new Error('Connection not available for this scope'))
        return
      }
      setArgs(next)
      if (def.connectionType === 'secret') {
        // Definitions with connection variables collect one input per variable;
        // without them, the single API-key field.
        if ((def.connectionVariables?.length ?? 0) > 0) {
          setVariableOpen(true)
        } else {
          setSecretOpen(true)
        }
        return
      }
      if (def.connectionType === 'oauth2-code') {
        const vars = def.connectionVariables ?? []
        // Reconnect reuses the stored variables (e.g. the Shopify shop) server-side,
        // so only prompt for them on a fresh connect — and try a silent token refresh
        // before falling back to the full OAuth flow.
        if (next.connectionId) {
          void attemptRefreshThenOAuth(next)
        } else if (vars.length > 0) {
          setVariableOpen(true)
        } else {
          kickOauth(next)
        }
        return
      }
      setError(new Error('App does not support connecting'))
    },
    [kickOauth, attemptRefreshThenOAuth]
  )

  const activeDef = useMemo(() => {
    if (!args) return null
    return args.scope === 'user'
      ? args.target.connectionDefinitions?.user
      : args.target.connectionDefinitions?.organization
  }, [args])

  const handleVariableSubmit = useCallback(
    (values: Record<string, string>) => {
      if (!args) return
      if (activeDef?.connectionType === 'secret') {
        saveSecret.mutate({
          appId: args.target.appId,
          installationId: args.target.installationId,
          appName: args.target.appTitle,
          connectionType: args.scope,
          values,
          connectionId: args.connectionId,
        })
        return
      }
      setVariableOpen(false)
      kickOauth(args, values)
    },
    [args, activeDef, kickOauth, saveSecret]
  )

  const handleSecretSubmit = useCallback(
    (secret: string) => {
      if (!args) return
      saveSecret.mutate({
        appId: args.target.appId,
        installationId: args.target.installationId,
        appName: args.target.appTitle,
        connectionType: args.scope,
        secret,
        connectionId: args.connectionId,
      })
    },
    [args, saveSecret]
  )

  const variableDefs: ConnectionVariable[] = useMemo(
    () => activeDef?.connectionVariables ?? [],
    [activeDef]
  )

  const Dialogs = args ? (
    <>
      <SecretConnectionForm
        open={secretOpen}
        onOpenChange={(open) => {
          setSecretOpen(open)
          if (!open) setArgs(null)
        }}
        connectionLabel={args.target.appTitle}
        connectionType={args.scope}
        pending={saveSecret.isPending}
        onSubmit={handleSecretSubmit}
      />
      <ConnectionVariableForm
        open={variableOpen}
        onOpenChange={(open) => {
          setVariableOpen(open)
          if (!open) setArgs(null)
        }}
        appTitle={args.target.appTitle}
        description={activeDef?.description ?? undefined}
        variables={variableDefs}
        prefill={args.prefillVariables}
        pending={saveSecret.isPending}
        onSubmit={handleVariableSubmit}
      />
    </>
  ) : null

  return {
    start,
    Dialogs,
    pending: saveSecret.isPending || secretOpen || variableOpen || oauthPending,
    lastConnectedCredId,
    error,
  }
}
