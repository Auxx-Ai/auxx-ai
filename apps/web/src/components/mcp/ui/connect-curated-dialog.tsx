// apps/web/src/components/mcp/ui/connect-curated-dialog.tsx
'use client'

import type { ConnectionVariable } from '@auxx/database'
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
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import { api } from '~/trpc/react'
import { useMcpOAuthPopup } from '../hooks/use-mcp-oauth-popup'
import { ConnectionVariableFields } from './connection-variable-fields'

interface ConnectCuratedDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverId: string
  serverName: string
  serverSlug: string
  connectionType: 'oauth2-code' | 'secret' | 'none' | null
  connectionVariables: ConnectionVariable[]
  onConnected: () => void
}

/**
 * Connect a curated server. Rows are generated from the server's `connectionVariables` (e.g.
 * Shopify's shop subdomain) plus a bearer token row when the server is secret-auth. Submits
 * `mcp.connect`; bearer/none → close + refresh, OAuth → popup (var values ride the authorize URL).
 *
 * An OAuth server with zero connection variables never opens this dialog — the caller connects
 * and opens the popup directly.
 */
export function ConnectCuratedDialog({
  open,
  onOpenChange,
  serverId,
  serverName,
  serverSlug,
  connectionType,
  connectionVariables,
  onConnected,
}: ConnectCuratedDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [token, setToken] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const oauth = useMcpOAuthPopup()
  const connect = api.mcp.connect.useMutation()
  const isPending = connect.isPending || oauth.pending
  const isSecret = connectionType === 'secret'

  function close() {
    setValues({})
    setToken('')
    setErrors({})
    onOpenChange(false)
  }

  function validate(): boolean {
    const next: Record<string, string> = {}
    for (const v of connectionVariables) {
      if (v.required !== false && !values[v.key]?.trim()) next[v.key] = `${v.label} is required`
    }
    if (isSecret && !token.trim()) next.__token = 'Token is required'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    try {
      const result = await connect.mutateAsync({
        serverId,
        connectionVariables: Object.keys(values).length > 0 ? values : undefined,
        token: isSecret ? token : undefined,
        returnTo: `/app/settings/apps/mcp/${serverSlug}`,
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
        toastError({
          title: 'Connection not available',
          description: 'This server needs OAuth client credentials that could not be registered.',
        })
      }
    } catch (err) {
      toastError({
        title: 'Failed to connect',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className='sm:max-w-[460px]' position='tc'>
        <DialogHeader>
          <DialogTitle>Connect {serverName}</DialogTitle>
          <DialogDescription>
            {isSecret
              ? 'Provide the connection details below.'
              : 'Provide the connection details, then authorize in the popup.'}
          </DialogDescription>
        </DialogHeader>

        <VarEditorField
          orientation='responsive'
          className='p-0 sm:[&_[data-slot=field-row-label]]:w-40'>
          <ConnectionVariableFields
            variables={connectionVariables}
            values={values}
            onValueChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
            showToken={isSecret}
            token={token}
            onTokenChange={setToken}
            errors={errors}
            disabled={isPending}
          />
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
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
