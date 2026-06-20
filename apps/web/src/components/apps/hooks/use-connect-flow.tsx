// apps/web/src/components/apps/hooks/use-connect-flow.tsx

'use client'

import type { ConnectionVariable } from '@auxx/database'
import { toastError } from '@auxx/ui/components/toast'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { ConnectionDetailDialog } from '~/components/connections/ui/connection-detail-dialog'
import type { DetailMethod } from '~/components/connections/ui/connection-detail-page'
import { useOAuthPopup } from '~/hooks/use-oauth-popup'
import { api, type RouterOutputs } from '~/trpc/react'

type Scope = 'user' | 'organization'

/**
 * The connection owner — an installed **app** (routes through `/api/apps/[slug]/oauth2/*` +
 * `apps.saveSecretConnection`) or a **platform** built-in provider (routes through
 * `/api/connections/[connectionDefinitionId]/oauth2/*` + `connections.save`). A platform
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
  /**
   * Abort an in-flight attempt and clear `pending` — the guaranteed manual escape when a caller
   * dismisses its surface mid-connect. Necessary because a popup on a `COOP: same-origin` provider
   * (Microsoft, Google) can't be auto-detected as closed; without this the UI stays disabled until
   * the hard timeout.
   */
  cancel: () => void
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

  // Shared OAuth-popup lifecycle: single-settle via message / server-side verify poll / hard
  // timeout, so a lost message (COOP severing, NGROK origin split) or an undetectable cancel never
  // leaves the caller's UI disabled. See `~/hooks/use-oauth-popup`.
  const { open: openPopup, pending: popupPending, cancel: cancelPopup } = useOAuthPopup()

  const [args, setArgs] = useState<ConnectFlowArgs | null>(null)
  // One dialog for every field-entry case (bare secret, multi-field secret, OAuth-with-vars) —
  // `ConnectionDetailDialog` renders the token row or the variable rows from the resolved method.
  const [formOpen, setFormOpen] = useState(false)
  // Pending for the silent refresh-token exchange that precedes the popup on reconnect.
  const [refreshPending, setRefreshPending] = useState(false)
  const [lastConnectedCredId, setLastConnectedCredId] = useState<string | null>(null)
  const [error, setError] = useState<Error | null>(null)

  // Refresh whichever connection lists the owner feeds.
  const invalidateForOwner = useCallback(
    (owner: ConnectOwner) => {
      if (owner.kind === 'app') {
        void utils.apps.listConnections.invalidate()
        void utils.apps.listInstalled.invalidate()
      } else {
        void utils.connections.list.invalidate()
      }
    },
    [utils]
  )

  // Reconnect first tries a silent OAuth refresh (see attemptRefreshThenOAuth); a connection is
  // just a credential, so it reuses the kind-agnostic connection refresh mutation.
  const refreshConnection = api.connections.refreshTokens.useMutation()

  // Secret-save success/error are shared across the app and platform mutations. `args` is read
  // through the latest render (React Query stores option callbacks in a ref), so it stays current.
  const onSecretSaved = (credId: string | null) => {
    setFormOpen(false)
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
  const savePlatformSecret = api.connections.save.useMutation({
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

      const fallbackUrl = `${baseUrl}?${params}`
      if (mode === 'redirect') {
        window.location.href = fallbackUrl
        return
      }

      const popupParams = new URLSearchParams(params)
      popupParams.set('mode', 'popup')

      // The shared core settles via the callback page's message, an authoritative list-poll, or a
      // hard timeout. The verify (built before the popup opens, so it baselines the current list)
      // resolves to the new credId on a fresh connect / a changed snapshot on reconnect.
      openPopup({
        popupUrl: `${baseUrl}?${popupParams}`,
        fallbackUrl,
        channelName: 'oauth-app-connect',
        verify: buildConnectionVerify(utils, a),
        onDone: (ok, credId) => {
          invalidateForOwner(owner)
          setArgs(null)
          const resolvedId = credId ?? (ok ? (a.connectionId ?? null) : null)
          if (ok && resolvedId) {
            setLastConnectedCredId(resolvedId)
            onConnected?.(resolvedId, a)
          }
          // A failure toasts in the core; a cancel/timeout settles silently. Either way the popup's
          // `pending` flips false, so the caller's disabled state recovers.
        },
      })
    },
    [mode, openPopup, utils, onConnected, invalidateForOwner]
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
      setRefreshPending(true)
      try {
        await refreshConnection.mutateAsync({ credentialId: a.connectionId })
        invalidateForOwner(a.target.owner)
        setRefreshPending(false)
        setLastConnectedCredId(a.connectionId)
        onConnected?.(a.connectionId, a)
        setArgs(null)
      } catch {
        // Refresh unavailable — fall back to the full OAuth re-authorization.
        setRefreshPending(false)
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
      // `client-credentials` has no browser step — the org enters its id/secret in the same
      // field form as a secret connection; the runtime mints the bearer lazily on first use.
      if (def.connectionType === 'secret' || def.connectionType === 'client-credentials') {
        // The one dialog handles both shapes — `ConnectionDetailPage` renders the token row for a
        // bare API key, or one row per connection variable when the def declares them.
        setFormOpen(true)
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
          setFormOpen(true)
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
      if (def.connectionType === 'secret' || def.connectionType === 'client-credentials') {
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

  // Single submit for the unified dialog: a secret def persists (`saveSecretForOwner` keeps the
  // dialog open until the save resolves, then `onSecretSaved` closes it); an OAuth def closes the
  // form and hands off to the popup. Mirrors `connectWith`, which the catalog uses to skip the dialog.
  const saveOrOauth = useCallback(
    (a: ConnectFlowArgs, payload: { values?: Record<string, string>; secret?: string }) => {
      const def = pickDef(a)
      if (def?.connectionType === 'secret' || def?.connectionType === 'client-credentials') {
        saveSecretForOwner(a, payload)
        return
      }
      if (def?.connectionType === 'oauth2-code') {
        setFormOpen(false)
        kickOauth(a, payload.values ?? {})
      }
    },
    [kickOauth, saveSecretForOwner]
  )

  // The single resolved method backing the dialog — built from the already-resolved activeDef.
  const method = useMemo<DetailMethod | null>(() => {
    if (!args || !activeDef) return null
    return {
      id: args.definitionId ?? activeDef.id ?? 'method',
      label: args.target.title,
      description: activeDef.description ?? null,
      connectionType: activeDef.connectionType,
      global: args.scope === 'organization',
      connectionVariables: activeDef.connectionVariables ?? [],
    }
  }, [args, activeDef])

  // Manual abort — tears down the popup flow and resets all pending state. Wired to the caller's
  // dialog-dismiss so the user can always escape a connect that can't be auto-detected as closed.
  const cancel = useCallback(() => {
    cancelPopup()
    setRefreshPending(false)
    setFormOpen(false)
    setArgs(null)
  }, [cancelPopup])

  const Dialogs =
    args && method ? (
      <ConnectionDetailDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setArgs(null)
        }}
        title={`${args.connectionId ? 'Reconnect' : 'Connect'} ${args.target.title}`}
        method={method}
        connectionId={args.connectionId}
        prefill={args.prefillVariables}
        pending={savePending}
        submitLabel={args.connectionId ? 'Reconnect' : 'Connect'}
        onSubmit={(payload) => saveOrOauth(args, payload)}
      />
    ) : null

  return {
    start,
    connectWith,
    Dialogs,
    // An open form is not "pending" — only an in-flight save, silent refresh, or OAuth popup is.
    pending: savePending || refreshPending || popupPending,
    cancel,
    lastConnectedCredId,
    error,
  }
}

type AppConnectionRow = RouterOutputs['apps']['listConnections'][number]
type PlatformConnectionRow = RouterOutputs['connections']['list'][number]

/**
 * Authoritative success backstop for {@link useOAuthPopup}, baselined against the current
 * connection list before the popup opens. Resolves to the connected credId once observed
 * server-side — a *new* matching credential on a fresh connect, or a *changed* snapshot
 * (status/expiry/`updatedAt`) on reconnect — and `null` while still pending. This makes the flow
 * resilient to a lost popup message (COOP severing the opener, or the dev NGROK origin split).
 */
function buildConnectionVerify(
  utils: ReturnType<typeof api.useUtils>,
  a: ConnectFlowArgs
): () => Promise<string | null> {
  const owner = a.target.owner
  const reconnectId = a.connectionId ?? null

  if (owner.kind === 'app') {
    const matches = (r: AppConnectionRow) =>
      r.appInstallationId === owner.installationId &&
      (!a.definitionId || r.connectionDefinitionId === a.definitionId)
    const snap = (r: AppConnectionRow) => `${r.connectionStatus}|${r.expiresAt ?? ''}`
    return buildVerify(
      reconnectId,
      () => utils.apps.listConnections.fetch(undefined, { staleTime: 0 }),
      utils.apps.listConnections.getData(),
      (r) => r.id,
      matches,
      snap
    )
  }

  const matches = (r: PlatformConnectionRow) =>
    r.scope === a.scope &&
    (r.connectionDefinitionId === owner.connectionDefinitionId || r.type === owner.providerKey)
  const snap = (r: PlatformConnectionRow) => `${r.status}|${r.updatedAt ?? ''}`
  return buildVerify(
    reconnectId,
    () => utils.connections.list.fetch(undefined, { staleTime: 0 }),
    utils.connections.list.getData(),
    (r) => r.id,
    matches,
    snap
  )
}

/**
 * Shared verify body for both owners. Fresh connect (`reconnectId == null`): baseline the set of
 * matching ids, then report the first *new* matching id. Reconnect: baseline the target row's
 * snapshot, then report `reconnectId` once that snapshot moves.
 *
 * The baseline MUST be captured before the connect can land — otherwise the freshly created row is
 * folded into the baseline and never seen as new. So we take it from the cached list synchronously
 * when warm, and otherwise kick a fetch immediately at construction (popup-open time), which
 * resolves long before the user finishes the provider consent screen.
 */
function buildVerify<Row>(
  reconnectId: string | null,
  fetchList: () => Promise<Row[]>,
  cached: Row[] | undefined,
  idOf: (r: Row) => string,
  matches: (r: Row) => boolean,
  snap: (r: Row) => string
): () => Promise<string | null> {
  let baselineIds: Set<string> | null = null
  let baselineSnap: string | null = null
  let baselineKnown = false

  const record = (list: Row[]) => {
    if (reconnectId) {
      const row = list.find((r) => idOf(r) === reconnectId)
      baselineSnap = row ? snap(row) : null
    } else {
      baselineIds = new Set(list.filter(matches).map(idOf))
    }
    baselineKnown = true
  }

  if (cached) record(cached)
  // No warm cache — prime the baseline now (before the connect can land), not on the first tick.
  const priming = baselineKnown
    ? null
    : fetchList()
        .then(record)
        .catch(() => {})

  return async () => {
    if (!baselineKnown && priming) await priming
    const list = await fetchList()
    if (!baselineKnown) {
      record(list)
      return null
    }
    if (reconnectId) {
      const row = list.find((r) => idOf(r) === reconnectId)
      return row && snap(row) !== baselineSnap ? reconnectId : null
    }
    const fresh = list.find((r) => matches(r) && !baselineIds?.has(idOf(r)))
    return fresh ? idOf(fresh) : null
  }
}
