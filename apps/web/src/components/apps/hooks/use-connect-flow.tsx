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
 * The connection owner — an installed **app** (routes through `/api/apps/[slug]/oauth2/*` +
 * `apps.saveSecretConnection`) or a **platform** built-in provider (routes through
 * `/api/connections/[connectionDefinitionId]/oauth2/*` + `connections.saveSecret`). A platform
 * provider has no app or installation; it is identified by its definition id / providerKey.
 */
export type ConnectOwner =
  | { kind: 'app'; appId: string; appSlug: string; installationId: string }
  | { kind: 'platform'; connectionDefinitionId: string; providerKey: string }

/**
 * Connection-definition fields useConnectFlow actually reads. Both the
 * settings-dialog (`AppData` from `apps.getBySlug`) and the picker
 * (`AppInstallation` from `apps.listInstalled`) carry these fields; this
 * narrow shape lets either source feed the hook without an adapter on
 * the consumer side.
 */
export interface ConnectFlowDefinition {
  /** ConnectionDefinition.id — present for app methods; threaded to the credential FK on save. */
  id?: string
  connectionType: string
  description?: string | null
  connectionVariables?: ConnectionVariable[] | null
}

export interface ConnectTarget {
  owner: ConnectOwner
  /** Display title (the app title, or the platform provider's label). */
  title: string
  /**
   * The scoped definitions. An app may define both a user- and an org-scoped connection; a
   * platform provider supplies its single definition under the key matching its `global` flag
   * (`global:true` → `organization`, else → `user`), and the caller passes the matching scope.
   */
  connectionDefinitions: {
    user?: ConnectFlowDefinition | null
    organization?: ConnectFlowDefinition | null
  }
  /**
   * Every connection method the app exposes. When an app offers more than one method (e.g. API
   * key OR OAuth), the picker passes the chosen method's id as `ConnectFlowArgs.definitionId` and
   * the flow resolves the def from here — disambiguating methods that share a scope.
   */
  methods?: ConnectFlowDefinition[]
}

export interface ConnectFlowArgs {
  target: ConnectTarget
  scope: Scope
  /** The chosen method (ConnectionDefinition.id) when an app exposes >1 method. */
  definitionId?: string
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
  /**
   * Connect with values collected by the caller — skips the hook's own
   * variable/secret dialog. For `secret` defs it persists `{values}`/`{secret}`;
   * for `oauth2-code` it kicks the OAuth flow with `values` as interpolation vars.
   * Lets a host (e.g. the connection catalog) render the fields in its own surface
   * while reusing the hook's OAuth popup + persistence.
   */
  connectWith: (
    args: ConnectFlowArgs,
    payload: { values?: Record<string, string>; secret?: string }
  ) => void
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
 * Single entry point for "start a connect attempt for owner X in scope Y" — app or platform
 * provider. Absorbs the inline branching from the legacy `AppConnections` flow.
 * See plans/kopilot/apps/app-settings-dialog-refactor.md §3 and
 * plans/connections/unify-connection-definition.md §8.
 */
/**
 * Resolve the connection definition an attempt targets. Prefers the explicitly picked method
 * (`definitionId`, looked up in `target.methods`) so methods sharing a scope are unambiguous;
 * falls back to the scope's definition for single-method callers that don't pass a definitionId.
 */
function pickDef(args: ConnectFlowArgs): ConnectFlowDefinition | null | undefined {
  if (args.definitionId) {
    const byId = args.target.methods?.find((m) => m.id === args.definitionId)
    if (byId) return byId
  }
  return args.scope === 'user'
    ? args.target.connectionDefinitions?.user
    : args.target.connectionDefinitions?.organization
}

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

  // Refresh whichever connection lists the owner feeds.
  const invalidateForOwner = useCallback(
    (owner: ConnectOwner) => {
      if (owner.kind === 'app') {
        void utils.apps.listConnections.invalidate()
        void utils.apps.listInstalled.invalidate()
      } else {
        void utils.credentials.list.invalidate()
      }
    },
    [utils]
  )

  // Reconnect first tries a silent OAuth refresh (see attemptRefreshThenOAuth); a connection is
  // just a credential, so it reuses the kind-agnostic credentials refresh mutation.
  const refreshConnection = api.credentials.refreshOAuthTokens.useMutation()

  // Secret-save success/error are shared across the app and platform mutations. `args` is read
  // through the latest render (React Query stores option callbacks in a ref), so it stays current.
  const onSecretSaved = (credId: string | null) => {
    setSecretOpen(false)
    setVariableOpen(false)
    if (args) invalidateForOwner(args.target.owner)
    if (credId) {
      setLastConnectedCredId(credId)
      if (args) onConnected?.(credId, args)
    }
    setArgs(null)
  }
  const onSecretError = (err: { message: string }) => {
    setError(err instanceof Error ? err : new Error(err.message))
    toastError({ title: 'Failed to save connection', description: err.message })
  }

  const saveAppSecret = api.apps.saveSecretConnection.useMutation({
    onSuccess: (data) => onSecretSaved(data?.credentialId ?? null),
    onError: onSecretError,
  })
  const savePlatformSecret = api.connections.saveSecret.useMutation({
    onSuccess: (data) => onSecretSaved(data?.credentialId ?? null),
    onError: onSecretError,
  })
  const savePending = saveAppSecret.isPending || savePlatformSecret.isPending

  const kickOauth = useCallback(
    (a: ConnectFlowArgs, vars: Record<string, string> = {}) => {
      const owner = a.target.owner
      const params = new URLSearchParams()
      if (a.connectionId) params.set('connectionId', a.connectionId)
      if (a.returnTo) params.set('returnTo', a.returnTo)
      for (const [key, value] of Object.entries(vars)) {
        if (value) params.set(`var_${key}`, value)
      }

      let baseUrl: string
      if (owner.kind === 'app') {
        params.set('installation', owner.installationId)
        params.set('type', a.scope)
        // The picked method (multi-method apps) — the authorize route looks the def up by id.
        if (a.definitionId) params.set('connectionDefinitionId', a.definitionId)
        baseUrl = `/api/apps/${owner.appSlug}/oauth2/authorize`
      } else {
        // Platform providers have no installation; scope is fixed by the definition's `global`.
        params.set('name', a.target.title)
        baseUrl = `/api/connections/${owner.connectionDefinitionId}/oauth2/authorize`
      }

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
        invalidateForOwner(owner)
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
    [mode, onConnected, teardown, invalidateForOwner]
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
        invalidateForOwner(a.target.owner)
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
    [kickOauth, refreshConnection, onConnected, invalidateForOwner]
  )

  const start = useCallback(
    (next: ConnectFlowArgs) => {
      setError(null)
      const def = pickDef(next)
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
      setError(new Error('This connection cannot be connected'))
    },
    [kickOauth, attemptRefreshThenOAuth]
  )

  const activeDef = useMemo(() => {
    if (!args) return null
    return pickDef(args)
  }, [args])

  // Persist a secret (multi-field values, or a single API key) for the active owner.
  const saveSecretForOwner = useCallback(
    (a: ConnectFlowArgs, payload: { values?: Record<string, string>; secret?: string }) => {
      const owner = a.target.owner
      if (owner.kind === 'app') {
        saveAppSecret.mutate({
          appId: owner.appId,
          installationId: owner.installationId,
          appName: a.target.title,
          connectionType: a.scope,
          ...payload,
          connectionId: a.connectionId,
          connectionDefinitionId: a.definitionId,
        })
      } else {
        savePlatformSecret.mutate({
          connectionDefinitionId: owner.connectionDefinitionId,
          name: a.target.title,
          ...payload,
          connectionId: a.connectionId,
        })
      }
    },
    [saveAppSecret, savePlatformSecret]
  )

  const connectWith = useCallback(
    (a: ConnectFlowArgs, payload: { values?: Record<string, string>; secret?: string }) => {
      setError(null)
      setArgs(a)
      const def = pickDef(a)
      if (!def) {
        setError(new Error('Connection not available for this scope'))
        return
      }
      if (def.connectionType === 'secret') {
        saveSecretForOwner(a, payload)
        return
      }
      if (def.connectionType === 'oauth2-code') {
        kickOauth(a, payload.values ?? {})
        return
      }
      setError(new Error('This connection cannot be connected'))
    },
    [kickOauth, saveSecretForOwner]
  )

  const handleVariableSubmit = useCallback(
    (values: Record<string, string>) => {
      if (!args) return
      if (activeDef?.connectionType === 'secret') {
        saveSecretForOwner(args, { values })
        return
      }
      setVariableOpen(false)
      kickOauth(args, values)
    },
    [args, activeDef, kickOauth, saveSecretForOwner]
  )

  const handleSecretSubmit = useCallback(
    (secret: string) => {
      if (!args) return
      saveSecretForOwner(args, { secret })
    },
    [args, saveSecretForOwner]
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
        connectionLabel={args.target.title}
        connectionType={args.scope}
        pending={savePending}
        onSubmit={handleSecretSubmit}
      />
      <ConnectionVariableForm
        open={variableOpen}
        onOpenChange={(open) => {
          setVariableOpen(open)
          if (!open) setArgs(null)
        }}
        appTitle={args.target.title}
        description={activeDef?.description ?? undefined}
        variables={variableDefs}
        prefill={args.prefillVariables}
        pending={savePending}
        onSubmit={handleVariableSubmit}
      />
    </>
  ) : null

  return {
    start,
    connectWith,
    Dialogs,
    pending: savePending || secretOpen || variableOpen || oauthPending,
    lastConnectedCredId,
    error,
  }
}
