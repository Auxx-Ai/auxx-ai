// apps/web/src/components/mcp/ui/add-mcp-server-dialog.tsx
'use client'

import { HIDDEN_VALUE } from '@auxx/credentials/crypto/client'
import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import { CopyButton } from '@auxx/ui/components/button-copy'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { ChevronDown, ChevronRight, ClipboardPaste, Plug, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { useMcpOAuthPopup } from '../hooks/use-mcp-oauth-popup'

type AuthMode = 'auto' | 'oauth' | 'bearer' | 'headers' | 'none'
type ResolveResult = RouterOutputs['mcp']['resolveSnippet'][number]
type RemoteResult = Extract<ResolveResult, { kind: 'remote' }>
type HeaderRow = { name: string; value: string }

const AUTH_OPTIONS = [
  { label: 'Auto-detect', value: 'auto' },
  { label: 'OAuth', value: 'oauth' },
  { label: 'Bearer token', value: 'bearer' },
  { label: 'Custom headers', value: 'headers' },
  { label: 'No authentication', value: 'none' },
]

/** Existing server fields the dialog edits in `update` mode. */
export interface McpServerEditTarget {
  serverId: string
  name: string
  endpoint: string
  connectionType: 'oauth2-code' | 'secret' | 'none' | null
  /** Derived server-side — distinguishes bearer from custom headers (both `'secret'`). */
  authPosture: 'oauth' | 'bearer' | 'headers' | 'none' | null
  /** Custom bearer header name (e.g. `X-API-Key`), from the credential metadata. */
  authHeaderName: string | null
  /** Header names of a headers-auth connection — prefills rows (values stay blank = keep). */
  headerNames: string[]
  /** OAuth config prefill from the ConnectionDefinition (only the MASK of the secret leaves the server). */
  oauth: {
    clientId: string | null
    clientSecret: string | null
    authorizeUrl: string | null
    tokenUrl: string | null
    scopes: string[]
  } | null
  /** Server-computed OAuth callback URL (CALLBACK_BASE can be ngrok — the browser can't derive it). */
  redirectUri?: string | null
}

interface AddMcpServerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful connect/update (or OAuth popup completion). */
  onConnected: () => void
  /** `create` (default) opens on the paste step; `update` opens straight on the fields step. */
  mode?: 'create' | 'update'
  /** Required for `update` — the server being edited. */
  server?: McpServerEditTarget
  /** Provider requires a client secret on token exchange (no public-client PKCE), e.g. GitHub. */
  secretRequired?: boolean
}

/**
 * Two-step dialog for adding (and editing) a custom MCP server.
 *  - **paste** — drop any URL / config snippet / install command; Resolve runs `mcp.resolveSnippet`
 *    and prefills the fields step (or pivots to the curated connect flow / shows an inline error).
 *  - **fields** — Name / Endpoint / Auth rows (auto / OAuth with client creds + endpoint
 *    overrides / bearer / custom headers / none); submit forks connected → close, `needsOAuth` →
 *    popup, `needsClientCredentials` → flip to OAuth mode for a retry with pasted creds.
 * In `update` mode the paste step is skipped: the dialog opens on **fields**, prefilled from the
 * passed server, and submits `mcp.update`.
 */
export function AddMcpServerDialog({
  open,
  onOpenChange,
  onConnected,
  mode = 'create',
  server,
  secretRequired = false,
}: AddMcpServerDialogProps) {
  const router = useRouter()
  const isUpdate = mode === 'update'

  // In update mode, seed the auth selector from the server's derived auth posture.
  const initialAuth: AuthMode = isUpdate ? (server?.authPosture ?? 'auto') : 'auto'
  const initialHeaderRows = (): HeaderRow[] =>
    isUpdate && server?.headerNames?.length
      ? server.headerNames.map((n) => ({ name: n, value: '' }))
      : [{ name: '', value: '' }]

  const [step, setStep] = useState<'paste' | 'fields' | 'multi'>(isUpdate ? 'fields' : 'paste')
  const [snippet, setSnippet] = useState('')
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [curatedPivot, setCuratedPivot] = useState<{ serverId: string } | null>(null)
  const [candidates, setCandidates] = useState<RemoteResult[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const [name, setName] = useState(server?.name ?? '')
  const [endpoint, setEndpoint] = useState(server?.endpoint ?? '')
  const [auth, setAuth] = useState<AuthMode>(initialAuth)
  const [token, setToken] = useState('')
  const [headerName, setHeaderName] = useState(server?.authHeaderName ?? '')
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(initialHeaderRows)
  // The secret prefill is a MASK — submitting it unchanged sends the HIDDEN_VALUE sentinel
  // so the server keeps the stored ciphertext.
  const secretPrefill = server?.oauth?.clientSecret ?? ''
  const [clientId, setClientId] = useState(server?.oauth?.clientId ?? '')
  const [clientSecret, setClientSecret] = useState(secretPrefill)
  const [authorizeUrl, setAuthorizeUrl] = useState(server?.oauth?.authorizeUrl ?? '')
  const [tokenUrl, setTokenUrl] = useState(server?.oauth?.tokenUrl ?? '')
  const [scopes, setScopes] = useState((server?.oauth?.scopes ?? []).join(' '))
  const [showOAuthAdvanced, setShowOAuthAdvanced] = useState(false)
  // Set once the server is eagerly saved to mint its per-server callback URL (keyed to the
  // endpoint it was generated for — editing the endpoint invalidates it back to the button).
  const [generatedCallback, setGeneratedCallback] = useState<{
    redirectUri: string
    endpoint: string
  } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [placeholders, setPlaceholders] = useState<string[]>([])
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({})
  const [enrichment, setEnrichment] = useState<{ description?: string; iconId?: string }>({})

  const oauth = useMcpOAuthPopup()
  const resolveSnippet = api.mcp.resolveSnippet.useMutation()
  const createServer = api.mcp.create.useMutation()
  const updateServer = api.mcp.update.useMutation()
  const servers = api.mcp.list.useQuery(undefined, { enabled: open })

  const isResolving = resolveSnippet.isPending
  const isSubmitting = createServer.isPending || updateServer.isPending || oauth.pending

  function reset() {
    setStep(isUpdate ? 'fields' : 'paste')
    setSnippet('')
    setResolveError(null)
    setCuratedPivot(null)
    setCandidates([])
    setSelected(new Set())
    setName(server?.name ?? '')
    setEndpoint(server?.endpoint ?? '')
    setAuth(initialAuth)
    setToken('')
    setHeaderName(server?.authHeaderName ?? '')
    setHeaderRows(initialHeaderRows())
    setClientId(server?.oauth?.clientId ?? '')
    setClientSecret(secretPrefill)
    setAuthorizeUrl(server?.oauth?.authorizeUrl ?? '')
    setTokenUrl(server?.oauth?.tokenUrl ?? '')
    setScopes((server?.oauth?.scopes ?? []).join(' '))
    setShowOAuthAdvanced(false)
    setGeneratedCallback(null)
    setErrors({})
    setPlaceholders([])
    setPlaceholderValues({})
    setEnrichment({})
  }

  function close() {
    reset()
    onOpenChange(false)
  }

  // ── Resolve ────────────────────────────────────────────────────────────────

  async function handleResolve() {
    const trimmed = snippet.trim()
    if (!trimmed) return
    setResolveError(null)
    setCuratedPivot(null)
    try {
      const results = await resolveSnippet.mutateAsync({ snippet: trimmed })
      const remotes = results.filter((r): r is RemoteResult => r.kind === 'remote')

      if (results.length === 0) {
        setResolveError("Couldn't read that — paste a URL, config snippet, or install command.")
        return
      }
      if (remotes.length > 1) {
        setCandidates(remotes)
        setSelected(new Set(remotes.map((_, i) => i)))
        setStep('multi')
        return
      }
      const single = results[0]!
      if (single.kind === 'remote') {
        if (single.curatedServerId) {
          setCuratedPivot({ serverId: single.curatedServerId })
          return
        }
        prefillFromRemote(single)
        setStep('fields')
        return
      }
      // local-only | unresolved
      setResolveError(single.reason)
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : 'Failed to resolve snippet')
    }
  }

  function prefillFromRemote(r: RemoteResult) {
    setName(r.name)
    setEndpoint(r.endpoint)
    setEnrichment({ description: r.description, iconId: r.iconUrl })

    const authValue = authHeaderValue(r)
    if (r.auth === 'oauth') {
      setAuth('auto')
    } else if (authValue !== undefined) {
      setAuth('bearer')
      setToken(authValue)
      setHeaderName(r.authHeaderName ?? '')
    } else {
      setAuth('none')
    }
    // Only endpoint placeholders need their own rows — the secret goes in the Token field.
    setPlaceholders((r.placeholders ?? []).filter((p) => referencesPlaceholder(r.endpoint, p)))
    setPlaceholderValues({})
  }

  // ── Submit (create / update) ─────────────────────────────────────────────────

  function validate(nameValue: string = name): boolean {
    const next: Record<string, string> = {}
    if (!nameValue.trim()) next.name = 'Name is required'
    if (!endpoint.trim()) next.endpoint = 'Endpoint URL is required'
    if (auth === 'bearer' && !token.trim() && !isUpdate) next.token = 'Token is required'
    if (auth === 'oauth') {
      // A generated callback URL for this endpoint means DCR already failed or is unavailable —
      // connecting without pasted creds can only bounce, so catch it client-side.
      if (!isUpdate && generatedCallback?.endpoint === resolvedEndpoint() && !clientId.trim()) {
        next.clientId =
          'Register an OAuth app with the callback URL below, then paste its Client ID'
      }
      if (clientSecret.trim() && !clientId.trim()) {
        next.clientId = 'Client ID is required when a secret is set'
      }
      // Only enforced once creds are being entered — a credless save (rename etc.) stays valid.
      if (secretRequired && clientId.trim() && !clientSecret.trim()) {
        next.clientSecret = 'This provider requires a client secret'
      }
      if (authorizeUrl.trim() && !isValidUrl(authorizeUrl)) {
        next.authorizeUrl = 'Must be a valid https URL'
      }
      if (tokenUrl.trim() && !isValidUrl(tokenUrl)) next.tokenUrl = 'Must be a valid https URL'
      // The overrides only work as a pair — discovery is skipped when both are set.
      if (authorizeUrl.trim() && !tokenUrl.trim()) next.tokenUrl = 'Token URL is required too'
      if (tokenUrl.trim() && !authorizeUrl.trim()) {
        next.authorizeUrl = 'Authorize URL is required too'
      }
    }
    if (auth === 'headers') {
      const touched = headerRows.filter((r) => r.name.trim() || r.value.trim())
      const complete = touched.filter((r) => r.name.trim() && r.value.trim())
      if (!isUpdate && complete.length === 0) {
        next.headers = 'Add at least one header (name and value)'
      } else if (touched.some((r) => r.value.trim() && !r.name.trim())) {
        next.headers = 'Every header value needs a name'
      } else if (complete.length > 0 && touched.length !== complete.length) {
        // Full-replace semantics: a partial set would silently drop the blank ones.
        next.headers = 'Fill in all header values, or leave all blank to keep the current ones'
      }
    }
    for (const p of placeholders) {
      if (!placeholderValues[p]?.trim()) next[`ph_${p}`] = `${p} is required`
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  /** OAuth payload — blank fields are omitted so the server keeps existing values. */
  function oauthInput() {
    if (auth !== 'oauth') return undefined
    const scopeList = scopes
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    return {
      clientId: clientId.trim() || undefined,
      clientSecret:
        secretPrefill && clientSecret === secretPrefill
          ? HIDDEN_VALUE
          : clientSecret.trim() || undefined,
      authorizeUrl: authorizeUrl.trim() || undefined,
      tokenUrl: tokenUrl.trim() || undefined,
      scopes: scopeList.length > 0 ? scopeList : undefined,
    }
  }

  /** Complete header rows — `undefined` (keep existing) when none are filled in. */
  function headersInput() {
    if (auth !== 'headers') return undefined
    const complete = headerRows
      .filter((r) => r.name.trim() && r.value.trim())
      .map((r) => ({ name: r.name.trim(), value: r.value.trim() }))
    return complete.length > 0 ? complete : undefined
  }

  function resolvedEndpoint(): string {
    let out = endpoint.trim()
    for (const p of placeholders) {
      const value = placeholderValues[p] ?? ''
      out = out.replace(new RegExp(`\\$\\{(?:env:|input:)?${escapeRe(p)}\\}`, 'g'), value)
    }
    return out
  }

  async function handleSubmit() {
    if (!validate()) return
    try {
      if (isUpdate && server) {
        await updateServer.mutateAsync({
          serverId: server.serverId,
          name: name.trim(),
          endpoint: resolvedEndpoint(),
          auth,
          token: auth === 'bearer' && token.trim() ? token.trim() : undefined,
          authHeaderName: customHeaderName(),
          headers: headersInput(),
          oauth: oauthInput(),
        })
        onConnected()
        close()
        return
      }

      const result = await createServer.mutateAsync(createInput())
      handleConnectOutcome(result)
    } catch (err) {
      toastError({
        title: isUpdate ? 'Failed to update server' : 'Failed to add server',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  function createInput(nameValue: string = name) {
    return {
      name: nameValue.trim(),
      endpoint: resolvedEndpoint(),
      auth,
      token: auth === 'bearer' ? token.trim() : undefined,
      authHeaderName: customHeaderName(),
      headers: headersInput(),
      oauth: oauthInput(),
      description: enrichment.description,
      icon: enrichment.iconId ? { iconId: enrichment.iconId } : undefined,
      returnTo: `/app/settings/apps/mcp/${slugifyName(nameValue)}`,
    }
  }

  function handleConnectOutcome(result: RouterOutputs['mcp']['create']) {
    if ('connected' in result && result.connected) {
      onConnected()
      close()
      return
    }
    if ('needsOAuth' in result && result.needsOAuth) {
      oauth.open({
        authorizeUrl: result.authorizeUrl,
        verifyServer: { serverId: result.serverId },
        onDone: (ok) => {
          if (ok) {
            onConnected()
            close()
          }
        },
      })
      return
    }
    if ('needsClientCredentials' in result && result.needsClientCredentials) {
      // The server is saved at this point — flip to OAuth mode and surface its callback URL so
      // the user can register an OAuth app, then paste the creds and resubmit (the create is
      // idempotent per endpoint and updates creds in place).
      setAuth('oauth')
      setShowOAuthAdvanced(true)
      setGeneratedCallback({ redirectUri: result.redirectUri, endpoint: resolvedEndpoint() })
      onConnected()
      toastError({
        title: 'Automatic registration unavailable',
        description:
          'Register an OAuth app with the callback URL shown below, then paste its Client ID and Secret.',
      })
    }
  }

  /**
   * Eagerly save the server (sans creds) so its per-server callback URL exists — most providers
   * require that URL to register an OAuth app, which is a chicken-and-egg with the serverId.
   * The saved server shows as "Not connected" in the list; resubmitting reuses it by endpoint.
   */
  async function handleGenerateCallback() {
    // Only the endpoint is truly required here — a blank name defaults to the endpoint host
    // (the state update lands async, so the derived value is passed through explicitly).
    const effectiveName = name.trim() || deriveNameFromEndpoint(resolvedEndpoint())
    if (effectiveName !== name) setName(effectiveName)
    if (!validate(effectiveName)) return
    try {
      const result = await createServer.mutateAsync(createInput(effectiveName))
      if ('needsClientCredentials' in result && result.needsClientCredentials) {
        setGeneratedCallback({ redirectUri: result.redirectUri, endpoint: resolvedEndpoint() })
        onConnected()
        return
      }
      // Endpoint reuse with stored creds, or a non-OAuth posture — same as a normal submit.
      handleConnectOutcome(result)
    } catch (err) {
      toastError({
        title: 'Failed to save server',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  /** Multi-candidate: create each selected remote sequentially, queuing OAuth popups. */
  async function handleCreateSelected() {
    const picks = candidates.filter((_, i) => selected.has(i))
    try {
      for (const c of picks) {
        const result = await createServer.mutateAsync({
          name: c.name,
          endpoint: c.endpoint,
          auth: c.auth === 'oauth' ? 'auto' : authHeaderValue(c) !== undefined ? 'bearer' : 'none',
          token: authHeaderValue(c),
          authHeaderName: c.authHeaderName,
          description: c.description,
          icon: c.iconUrl ? { iconId: c.iconUrl } : undefined,
          returnTo: `/app/settings/apps/mcp/${slugifyName(c.name)}`,
        })
        if ('needsOAuth' in result && result.needsOAuth) {
          await new Promise<void>((resolve) =>
            oauth.open({
              authorizeUrl: result.authorizeUrl,
              verifyServer: { serverId: result.serverId },
              onDone: () => resolve(),
            })
          )
        }
      }
      onConnected()
      close()
    } catch (err) {
      toastError({
        title: 'Failed to add servers',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  function customHeaderName(): string | undefined {
    const h = headerName.trim()
    return auth === 'bearer' && h && h.toLowerCase() !== 'authorization' ? h : undefined
  }

  function goToCuratedServer() {
    const match = servers.data?.find((s) => s.serverId === curatedPivot?.serverId)
    close()
    if (match) router.push(`/app/settings/apps/mcp/${match.slug}`)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const crumbLabel =
    step === 'paste' ? 'Paste' : step === 'multi' ? 'Select servers' : 'Server details'

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent innerClassName='p-0' position='tc' size='content'>
        <div className='flex flex-col'>
          <DialogNav
            title={isUpdate ? 'Edit MCP server' : 'Add custom MCP server'}
            description='Connect a Streamable HTTP MCP server by pasting its URL, config, or install command.'
            onBack={step === 'fields' && !isUpdate ? () => setStep('paste') : undefined}
            backDisabled={isSubmitting}
            crumbs={[{ label: crumbLabel, icon: <Plug /> }]}
          />

          <DialogNavPages value={step}>
            <DialogNavPage value='paste' size='sm'>
              <div className='flex flex-col gap-1.5 p-3'>
                <Label htmlFor='mcp-snippet'>Paste a URL, config snippet, or install command</Label>
                <Textarea
                  id='mcp-snippet'
                  value={snippet}
                  onChange={(e) => setSnippet(e.target.value)}
                  placeholder={
                    'https://mcp.example.com/mcp\n\nor a JSON / TOML config, or a `claude mcp add …` command'
                  }
                  rows={5}
                  className='font-mono text-sm'
                  disabled={isResolving}
                />
                {resolveError && <p className='text-destructive text-xs'>{resolveError}</p>}
                {curatedPivot ? (
                  <div className='flex items-center justify-between rounded-md border bg-primary-50 p-2 text-xs'>
                    <span>We host this one — connect it directly.</span>
                    <Button size='sm' variant='outline' onClick={goToCuratedServer}>
                      Connect
                    </Button>
                  </div>
                ) : (
                  <button
                    type='button'
                    onClick={() => setStep('fields')}
                    className='self-start text-muted-foreground text-xs underline-offset-2 hover:underline'>
                    or fill in manually
                  </button>
                )}
              </div>
            </DialogNavPage>

            <DialogNavPage value='fields' size='sm'>
              <div className='p-3'>{renderFields()}</div>
            </DialogNavPage>

            <DialogNavPage value='multi' size='sm'>
              <div className='flex flex-col gap-2 p-3'>
                <Label>Found {candidates.length} servers — pick which to add</Label>
                {candidates.map((c, i) => (
                  <label
                    key={`${c.endpoint}-${i}`}
                    className='flex items-center gap-2 rounded-md border p-2 text-sm'>
                    <Checkbox
                      checked={selected.has(i)}
                      onCheckedChange={(v) =>
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (v) next.add(i)
                          else next.delete(i)
                          return next
                        })
                      }
                    />
                    <div className='min-w-0'>
                      <div className='font-medium'>{c.name}</div>
                      <div className='truncate font-mono text-muted-foreground text-xs'>
                        {c.endpoint}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </DialogNavPage>
          </DialogNavPages>

          <DialogFooter className='mt-0 border-t p-3'>
            <Button
              size='sm'
              variant='ghost'
              onClick={close}
              disabled={isSubmitting || isResolving}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            {step === 'paste' && (
              <Button
                size='sm'
                variant='outline'
                onClick={handleResolve}
                loading={isResolving}
                loadingText='Resolving...'
                data-dialog-submit>
                <ClipboardPaste />
                Resolve <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
            {step === 'fields' && (
              <Button
                size='sm'
                variant='outline'
                onClick={handleSubmit}
                loading={isSubmitting}
                loadingText={isUpdate ? 'Saving...' : 'Connecting...'}
                data-dialog-submit>
                {isUpdate ? 'Save' : 'Connect'} <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
            {step === 'multi' && (
              <Button
                size='sm'
                variant='outline'
                onClick={handleCreateSelected}
                disabled={selected.size === 0}
                loading={isSubmitting}
                loadingText='Connecting...'
                data-dialog-submit>
                Add {selected.size} <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )

  function renderFields() {
    return (
      <>
        <VarEditorField
          orientation='responsive'
          className='p-0 sm:[&_[data-slot=field-row-label]]:w-40'>
          <VarEditorFieldRow
            title='Name'
            type={BaseType.STRING}
            showIcon
            isRequired
            validationError={errors.name}>
            <div className='flex items-center gap-2'>
              {enrichment.iconId && <AppIcon iconId={enrichment.iconId} size='sm' />}
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={name}
                onChange={(v) => setName((v as string) ?? '')}
                placeholder='e.g. Acme Tools'
                disabled={isSubmitting}
              />
            </div>
          </VarEditorFieldRow>

          <VarEditorFieldRow
            title='Endpoint URL'
            type={BaseType.STRING}
            showIcon
            isRequired
            validationError={errors.endpoint}>
            <FieldInputAdapter
              fieldType={FieldType.URL}
              value={endpoint}
              onChange={(v) => setEndpoint((v as string) ?? '')}
              placeholder='https://example.com/mcp'
              disabled={isSubmitting}
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow title='Authentication' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              triggerProps={{ className: 'w-full ps-0 pe-1' }}
              fieldOptions={{ options: AUTH_OPTIONS }}
              value={[auth]}
              onChange={(v) => setAuth(((v as string[])[0] as AuthMode) ?? 'auto')}
              disabled={isSubmitting}
            />
          </VarEditorFieldRow>

          {auth === 'bearer' && (
            <>
              <VarEditorFieldRow
                title='Token'
                type={BaseType.STRING}
                showIcon
                isRequired={!isUpdate}
                validationError={errors.token}>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={token}
                  onChange={(v) => setToken((v as string) ?? '')}
                  placeholder={isUpdate ? 'Leave blank to keep current token' : 'Secret token'}
                  disabled={isSubmitting}
                />
              </VarEditorFieldRow>
              <VarEditorFieldRow title='Header name' type={BaseType.STRING} showIcon>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={headerName}
                  onChange={(v) => setHeaderName((v as string) ?? '')}
                  placeholder='Authorization'
                  disabled={isSubmitting}
                />
              </VarEditorFieldRow>
            </>
          )}

          {auth === 'headers' && (
            <VarEditorFieldRow
              title='Headers'
              type={BaseType.STRING}
              showIcon
              isRequired={!isUpdate}
              validationError={errors.headers}>
              <div className='flex flex-col gap-2'>
                {headerRows.map((row, i) => (
                  <div key={i} className='flex items-center gap-2'>
                    <FieldInputAdapter
                      fieldType={FieldType.TEXT}
                      value={row.name}
                      onChange={(v) => updateHeaderRow(i, { name: (v as string) ?? '' })}
                      placeholder='X-API-Key'
                      disabled={isSubmitting}
                    />
                    <FieldInputAdapter
                      fieldType={FieldType.TEXT}
                      value={row.value}
                      onChange={(v) => updateHeaderRow(i, { value: (v as string) ?? '' })}
                      placeholder={
                        isUpdate && row.name && !row.value ? 'Blank keeps current value' : 'Value'
                      }
                      disabled={isSubmitting}
                    />
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => removeHeaderRow(i)}
                      disabled={isSubmitting || headerRows.length === 1}>
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button
                  variant='ghost'
                  size='sm'
                  className='self-start'
                  onClick={() => setHeaderRows((prev) => [...prev, { name: '', value: '' }])}
                  disabled={isSubmitting}>
                  <Plus />
                  Add header
                </Button>
              </div>
            </VarEditorFieldRow>
          )}

          {auth === 'oauth' && (
            <>
              <VarEditorFieldRow
                title='Client ID'
                type={BaseType.STRING}
                showIcon
                validationError={errors.clientId}>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={clientId}
                  onChange={(v) => setClientId((v as string) ?? '')}
                  placeholder='Blank tries automatic registration (DCR)'
                  disabled={isSubmitting}
                />
              </VarEditorFieldRow>
              <VarEditorFieldRow
                title='Client Secret'
                type={BaseType.STRING}
                showIcon
                isRequired={secretRequired}
                validationError={errors.clientSecret}>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={clientSecret}
                  onChange={(v) => setClientSecret((v as string) ?? '')}
                  placeholder={
                    secretRequired && !secretPrefill
                      ? 'Required by this provider'
                      : isUpdate
                        ? 'Leave blank to keep current secret'
                        : 'Optional for public clients'
                  }
                  disabled={isSubmitting}
                />
              </VarEditorFieldRow>
            </>
          )}

          {placeholders.map((p) => (
            <VarEditorFieldRow
              key={p}
              title={p}
              type={BaseType.STRING}
              showIcon
              isRequired
              validationError={errors[`ph_${p}`]}>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={placeholderValues[p] ?? ''}
                onChange={(v) =>
                  setPlaceholderValues((prev) => ({ ...prev, [p]: (v as string) ?? '' }))
                }
                placeholder={`Value for ${p}`}
                disabled={isSubmitting}
              />
            </VarEditorFieldRow>
          ))}
        </VarEditorField>

        {auth === 'oauth' && (
          <div className='mt-4'>
            <button
              type='button'
              onClick={() => setShowOAuthAdvanced((v) => !v)}
              className='flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors'>
              {showOAuthAdvanced ? (
                <ChevronDown className='h-4 w-4' />
              ) : (
                <ChevronRight className='h-4 w-4' />
              )}
              Advanced OAuth settings
            </button>
            {showOAuthAdvanced && (
              <VarEditorField
                orientation='responsive'
                className='p-0 mt-4 sm:[&_[data-slot=field-row-label]]:w-40'>
                <VarEditorFieldRow
                  title='Authorize URL'
                  type={BaseType.STRING}
                  showIcon
                  validationError={errors.authorizeUrl}>
                  <FieldInputAdapter
                    fieldType={FieldType.URL}
                    value={authorizeUrl}
                    onChange={(v) => setAuthorizeUrl((v as string) ?? '')}
                    placeholder='Blank uses OAuth discovery'
                    disabled={isSubmitting}
                  />
                </VarEditorFieldRow>
                <VarEditorFieldRow
                  title='Token URL'
                  type={BaseType.STRING}
                  showIcon
                  validationError={errors.tokenUrl}>
                  <FieldInputAdapter
                    fieldType={FieldType.URL}
                    value={tokenUrl}
                    onChange={(v) => setTokenUrl((v as string) ?? '')}
                    placeholder='Blank uses OAuth discovery'
                    disabled={isSubmitting}
                  />
                </VarEditorFieldRow>
                <VarEditorFieldRow title='Scopes' type={BaseType.STRING} showIcon>
                  <FieldInputAdapter
                    fieldType={FieldType.TEXT}
                    value={scopes}
                    onChange={(v) => setScopes((v as string) ?? '')}
                    placeholder='Space-separated, e.g. read write'
                    disabled={isSubmitting}
                  />
                </VarEditorFieldRow>
                <VarEditorFieldRow title='Callback URL' type={BaseType.STRING} showIcon>
                  {renderCallbackUrl()}
                </VarEditorFieldRow>
              </VarEditorField>
            )}
          </div>
        )}
      </>
    )
  }

  /**
   * Callback URL row: in update mode the server-computed URL; in create mode the generated one
   * (only while the endpoint still matches what it was generated for), else the generate button.
   */
  function renderCallbackUrl() {
    const callbackUrl = isUpdate
      ? server?.redirectUri
      : generatedCallback && generatedCallback.endpoint === resolvedEndpoint()
        ? generatedCallback.redirectUri
        : null
    if (callbackUrl) {
      return (
        <div className='flex flex-col gap-1 pe-1'>
          <div className='flex items-center gap-1'>
            <code className='break-all  py-1 font-mono text-xs'>{callbackUrl}</code>
            <CopyButton text={callbackUrl} />
          </div>
          {!isUpdate && (
            <p className='text-muted-foreground text-xs'>
              Server saved. Register this callback URL with your OAuth provider, then paste the
              Client ID and Secret above and connect.
            </p>
          )}
        </div>
      )
    }
    return (
      <div className='flex flex-col gap-1 my-0.5'>
        <Button
          variant='outline'
          size='xs'
          className='self-start'
          onClick={handleGenerateCallback}
          disabled={!endpoint.trim()}
          loading={createServer.isPending}
          loadingText='Saving...'>
          Generate callback URL
        </Button>
        <p className='text-primary-400 text-xs'>
          {endpoint.trim()
            ? 'Saves the server first — providers need this URL to register an OAuth app.'
            : 'Enter the endpoint URL first — generating saves the server.'}
        </p>
      </div>
    )
  }

  function updateHeaderRow(index: number, patch: Partial<HeaderRow>) {
    setHeaderRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function removeHeaderRow(index: number) {
    setHeaderRows((prev) =>
      prev.length === 1 ? [{ name: '', value: '' }] : prev.filter((_, i) => i !== index)
    )
  }
}

function isValidUrl(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === 'https:'
  } catch {
    return false
  }
}

/** Extract the literal secret from a remote's auth header (`Authorization: Bearer x` → `x`). */
function authHeaderValue(r: RemoteResult): string | undefined {
  const headers = r.headers
  if (!headers) return undefined
  const authKey = Object.keys(headers).find((k) => k.toLowerCase() === 'authorization')
  const key = authKey ?? r.authHeaderName ?? Object.keys(headers)[0]
  if (!key) return undefined
  const raw = headers[key] ?? ''
  if (/\$\{.+\}/.test(raw)) return undefined // placeholder, not a literal
  return raw.replace(/^Bearer\s+/i, '')
}

function referencesPlaceholder(text: string, name: string): boolean {
  return new RegExp(`\\$\\{(?:env:|input:)?${escapeRe(name)}\\}`).test(text)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Default server name from the endpoint host (e.g. https://mcp.linear.app/mcp → "mcp.linear.app"). */
function deriveNameFromEndpoint(endpoint: string): string {
  try {
    return new URL(endpoint.trim()).hostname
  } catch {
    return ''
  }
}

/** Best-effort slug for the OAuth returnTo (server slugifies authoritatively). */
function slugifyName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'mcp-server'
  )
}
