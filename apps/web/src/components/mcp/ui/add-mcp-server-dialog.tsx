// apps/web/src/components/mcp/ui/add-mcp-server-dialog.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { ClipboardPaste, Plug } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { useMcpOAuthPopup } from '../hooks/use-mcp-oauth-popup'

type AuthMode = 'auto' | 'bearer' | 'none'
type ResolveResult = RouterOutputs['mcp']['resolveSnippet'][number]
type RemoteResult = Extract<ResolveResult, { kind: 'remote' }>

const AUTH_OPTIONS = [
  { label: 'Auto-detect', value: 'auto' },
  { label: 'Bearer token', value: 'bearer' },
  { label: 'No authentication', value: 'none' },
]

/** Existing server fields the dialog edits in `update` mode. */
export interface McpServerEditTarget {
  serverId: string
  name: string
  endpoint: string
  connectionType: 'oauth2-code' | 'secret' | 'none' | null
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
}

/**
 * Two-step dialog for adding (and editing) a custom MCP server.
 *  - **paste** — drop any URL / config snippet / install command; Resolve runs `mcp.resolveSnippet`
 *    and prefills the fields step (or pivots to the curated connect flow / shows an inline error).
 *  - **fields** — Name / Endpoint / Auth rows; submit forks connected → close, `needsOAuth` → popup,
 *    `needsClientCredentials` → reveal client-cred rows.
 * In `update` mode the paste step is skipped: the dialog opens on **fields**, prefilled from the
 * passed server, and submits `mcp.update`.
 */
export function AddMcpServerDialog({
  open,
  onOpenChange,
  onConnected,
  mode = 'create',
  server,
}: AddMcpServerDialogProps) {
  const router = useRouter()
  const isUpdate = mode === 'update'

  // In update mode, seed the auth selector from the server's current connection type.
  const initialAuth: AuthMode =
    isUpdate && server?.connectionType === 'secret'
      ? 'bearer'
      : isUpdate && server?.connectionType === 'none'
        ? 'none'
        : 'auto'

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
  const [headerName, setHeaderName] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [needsClientCreds, setNeedsClientCreds] = useState(false)
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
    setHeaderName('')
    setClientId('')
    setClientSecret('')
    setNeedsClientCreds(false)
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

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = 'Name is required'
    if (!endpoint.trim()) next.endpoint = 'Endpoint URL is required'
    if (auth === 'bearer' && !token.trim() && !isUpdate) next.token = 'Token is required'
    if (needsClientCreds && !clientId.trim()) next.clientId = 'Client ID is required'
    for (const p of placeholders) {
      if (!placeholderValues[p]?.trim()) next[`ph_${p}`] = `${p} is required`
    }
    setErrors(next)
    return Object.keys(next).length === 0
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

  function createInput() {
    return {
      name: name.trim(),
      endpoint: resolvedEndpoint(),
      auth,
      token: auth === 'bearer' ? token.trim() : undefined,
      authHeaderName: customHeaderName(),
      description: enrichment.description,
      icon: enrichment.iconId ? { iconId: enrichment.iconId } : undefined,
      clientId: needsClientCreds ? clientId : undefined,
      clientSecret: needsClientCreds ? clientSecret || undefined : undefined,
      returnTo: `/app/settings/apps/mcp/${slugifyName(name)}`,
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
      setNeedsClientCreds(true)
      toastError({
        title: 'Automatic registration unavailable',
        description: 'Paste an OAuth Client ID (and Secret) from the provider to continue.',
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
            oauth.open({ authorizeUrl: result.authorizeUrl, onDone: () => resolve() })
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
                {isUpdate ? 'Save' : needsClientCreds ? 'Retry' : 'Connect'}{' '}
                <KbdSubmit variant='outline' size='sm' />
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

        {needsClientCreds && (
          <>
            <VarEditorFieldRow
              title='Client ID'
              type={BaseType.STRING}
              showIcon
              isRequired
              validationError={errors.clientId}>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={clientId}
                onChange={(v) => setClientId((v as string) ?? '')}
                placeholder='OAuth client ID'
                disabled={isSubmitting}
              />
            </VarEditorFieldRow>
            <VarEditorFieldRow title='Client Secret' type={BaseType.STRING} showIcon>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={clientSecret}
                onChange={(v) => setClientSecret((v as string) ?? '')}
                placeholder='OAuth client secret (optional for public clients)'
                disabled={isSubmitting}
              />
            </VarEditorFieldRow>
          </>
        )}
      </VarEditorField>
    )
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

/** Best-effort slug for the OAuth returnTo (server slugifies authoritatively). */
function slugifyName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'mcp-server'
  )
}
