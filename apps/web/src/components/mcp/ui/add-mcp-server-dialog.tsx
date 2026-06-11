// apps/web/src/components/mcp/ui/add-mcp-server-dialog.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { toastError } from '@auxx/ui/components/toast'
import { useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'
import { useMcpOAuthPopup } from '../hooks/use-mcp-oauth-popup'

type AuthMode = 'auto' | 'bearer' | 'none'

const AUTH_OPTIONS = [
  { label: 'Auto-detect', value: 'auto' },
  { label: 'Bearer token', value: 'bearer' },
  { label: 'No authentication', value: 'none' },
]

interface AddMcpServerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful connect (or OAuth popup completion). */
  onConnected: () => void
}

/**
 * Create a custom MCP server from a pasted Streamable HTTP URL. Submits `mcp.create`, then forks:
 * connected → close; `needsOAuth` → OAuth popup; `needsClientCredentials` → reveal client-cred
 * rows for a resubmit (DCR-failure escape hatch).
 */
export function AddMcpServerDialog({ open, onOpenChange, onConnected }: AddMcpServerDialogProps) {
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [auth, setAuth] = useState<AuthMode>('auto')
  const [token, setToken] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [needsClientCreds, setNeedsClientCreds] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const oauth = useMcpOAuthPopup()
  const createServer = api.mcp.create.useMutation()
  const isPending = createServer.isPending || oauth.pending

  function reset() {
    setName('')
    setEndpoint('')
    setAuth('auto')
    setToken('')
    setClientId('')
    setClientSecret('')
    setNeedsClientCreds(false)
    setErrors({})
  }

  function close() {
    reset()
    onOpenChange(false)
  }

  function validate(): boolean {
    const next: Record<string, string> = {}
    if (!name.trim()) next.name = 'Name is required'
    if (!endpoint.trim()) next.endpoint = 'Endpoint URL is required'
    if (auth === 'bearer' && !token.trim()) next.token = 'Token is required for bearer auth'
    if (needsClientCreds && !clientId.trim()) next.clientId = 'Client ID is required'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    try {
      const result = await createServer.mutateAsync({
        name: name.trim(),
        endpoint: endpoint.trim(),
        auth,
        token: auth === 'bearer' ? token : undefined,
        clientId: needsClientCreds ? clientId : undefined,
        clientSecret: needsClientCreds ? clientSecret || undefined : undefined,
        returnTo: `/app/settings/apps/mcp/${slugifyName(name)}`,
      })

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
    } catch (err) {
      toastError({
        title: 'Failed to add server',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className='sm:max-w-[500px]' position='tc'>
        <DialogHeader>
          <DialogTitle>Add custom MCP server</DialogTitle>
          <DialogDescription>
            Connect a Streamable HTTP MCP server by pasting its URL. We'll detect how it
            authenticates.
          </DialogDescription>
        </DialogHeader>

        <VarEditorField
          orientation='responsive'
          className='p-0 sm:[&_[data-slot=field-row-label]]:w-40'>
          <VarEditorFieldRow
            title='Name'
            type={BaseType.STRING}
            showIcon
            isRequired
            validationError={errors.name}>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={name}
              onChange={(v) => setName((v as string) ?? '')}
              placeholder='e.g. Acme Tools'
              disabled={isPending}
            />
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
              disabled={isPending}
            />
          </VarEditorFieldRow>

          <VarEditorFieldRow title='Authentication' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.SINGLE_SELECT}
              fieldOptions={{ options: AUTH_OPTIONS }}
              value={[auth]}
              onChange={(v) => setAuth(((v as string[])[0] as AuthMode) ?? 'auto')}
              disabled={isPending}
            />
          </VarEditorFieldRow>

          {auth === 'bearer' && (
            <VarEditorFieldRow
              title='Token'
              type={BaseType.STRING}
              showIcon
              isRequired
              validationError={errors.token}>
              <FieldInputAdapter
                fieldType={FieldType.TEXT}
                value={token}
                onChange={(v) => setToken((v as string) ?? '')}
                placeholder='Bearer token'
                disabled={isPending}
              />
            </VarEditorFieldRow>
          )}

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
                  disabled={isPending}
                />
              </VarEditorFieldRow>
              <VarEditorFieldRow title='Client Secret' type={BaseType.STRING} showIcon>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={clientSecret}
                  onChange={(v) => setClientSecret((v as string) ?? '')}
                  placeholder='OAuth client secret (optional for public clients)'
                  disabled={isPending}
                />
              </VarEditorFieldRow>
            </>
          )}
        </VarEditorField>

        <DialogFooter>
          <Button type='button' variant='ghost' size='sm' onClick={close} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            variant='outline'
            size='sm'
            loading={isPending}
            loadingText='Connecting...'>
            {needsClientCreds ? 'Retry' : 'Connect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
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
