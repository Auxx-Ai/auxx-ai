// apps/web/src/components/mcp/ui/mcp-template-dialog.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { buildCreateOAuthAppUrl } from '@auxx/lib/ai/mcp/templates/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { CopyButton } from '@auxx/ui/components/button-copy'
import { KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { Plug } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { ConnectionVariableFields } from '~/components/connections/ui/connection-variable-fields'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { TemplateGalleryDialog } from '~/components/templates/ui'
import { BaseType } from '~/components/workflow/types'
import { VarEditorField, VarEditorFieldRow } from '~/components/workflow/ui/input-editor/var-editor'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { useMcpOAuthPopup } from '../hooks/use-mcp-oauth-popup'
import { useMcpServers } from '../hooks/use-mcp-servers'

type McpTemplate = RouterOutputs['mcp']['listTemplates']['templates'][number]

interface McpTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful connect (or OAuth popup completion). */
  onConnected: () => void
}

/**
 * "Connect from template" dialog for Settings → Apps. The gallery shell (sidebar,
 * search, list) lives in `TemplateGalleryDialog`; this component keeps all the
 * connect logic. Clicking a template connects one-click — OAuth goes straight to
 * the popup, already-connected templates route to their server page — while
 * templates needing connection variables or a token open an inline fields step on
 * the gallery's detail page.
 */
export function McpTemplateDialog({ open, onOpenChange, onConnected }: McpTemplateDialogProps) {
  const router = useRouter()
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [token, setToken] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  // Manual (non-DCR) template setup: set once the org server is eagerly saved so its
  // per-server callback URL exists to register at the provider.
  const [manualSetup, setManualSetup] = useState<{ redirectUri: string; slug: string } | null>(null)
  const [manualClientId, setManualClientId] = useState('')
  const [manualClientSecret, setManualClientSecret] = useState('')

  const catalog = api.mcp.listTemplates.useQuery(undefined, { enabled: open })
  const connectTemplate = api.mcp.connectTemplate.useMutation()
  const createServer = api.mcp.create.useMutation()
  const oauth = useMcpOAuthPopup()
  const { servers } = useMcpServers()

  const templates = useMemo(() => catalog.data?.templates ?? [], [catalog.data])
  const categories = catalog.data?.categories ?? []
  const isSubmitting = connectTemplate.isPending || createServer.isPending || oauth.pending

  /** Server matching a template — by slug, or by endpoint when the slug was deduped. */
  const serverFor = (template: McpTemplate) =>
    servers.find((s) => s.slug === template.id || s.endpoint === template.endpoint)

  function resetFields() {
    setConnectingId(null)
    setValues({})
    setToken('')
    setErrors({})
    setManualSetup(null)
    setManualClientId('')
    setManualClientSecret('')
  }

  function close() {
    onOpenChange(false)
  }

  function handleConnected(slug: string) {
    onConnected()
    close()
    router.push(`/app/settings/apps/mcp/${slug}`)
  }

  async function connect(template: McpTemplate, vars?: Record<string, string>, secret?: string) {
    try {
      const result = await connectTemplate.mutateAsync({
        templateId: template.id,
        connectionVariables: vars && Object.keys(vars).length > 0 ? vars : undefined,
        token: secret || undefined,
        returnTo: `/app/settings/apps/mcp/${template.id}`,
      })
      if ('connected' in result && result.connected) {
        handleConnected(result.slug)
        return
      }
      if ('needsOAuth' in result && result.needsOAuth) {
        oauth.open({
          authorizeUrl: result.authorizeUrl,
          verifyServer: { serverId: result.serverId, endpoint: template.endpoint },
          onDone: (ok) => {
            if (ok) handleConnected(result.slug)
            else setConnectingId(null)
          },
        })
        return
      }
      if ('needsClientCredentials' in result && result.needsClientCredentials) {
        setConnectingId(null)
        toastError({
          title: 'Connection not available',
          description:
            'This server needs OAuth client credentials that could not be registered automatically. Add it as a custom server instead.',
        })
      }
    } catch (err) {
      setConnectingId(null)
      toastError({
        title: 'Failed to connect',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  /**
   * Mixed one-click / detail entry. Connected and variable-free templates connect
   * (or navigate) directly and report `'handled'`; templates needing fields fall
   * through (`void`) so the gallery opens its detail page.
   */
  async function handleSelectTemplate(template: McpTemplate): Promise<void | 'handled'> {
    const existing = serverFor(template)
    if (existing?.connectionPresent) {
      close()
      router.push(`/app/settings/apps/mcp/${existing.slug}`)
      return 'handled'
    }

    if (template.clientRegistration === 'manual') {
      // The detail step hosts the whole setup (generate callback URL → register app → creds →
      // connect). A pending half-done server is picked back up by the idempotent generate.
      return
    }

    const needsFields =
      (template.connectionVariables?.length ?? 0) > 0 || template.connectionType === 'secret'
    if (needsFields) {
      setValues({})
      setToken('')
      setErrors({})
      return
    }

    setConnectingId(template.id)
    await connect(template)
    return 'handled'
  }

  function validateFields(template: McpTemplate): boolean {
    const next: Record<string, string> = {}
    for (const v of template.connectionVariables ?? []) {
      if (v.required !== false && !values[v.key]?.trim()) next[v.key] = `${v.label} is required`
    }
    if (template.connectionType === 'secret' && !token.trim()) next.__token = 'Token is required'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmitFields(template: McpTemplate) {
    if (!validateFields(template)) return
    setConnectingId(template.id)
    await connect(template, values, token)
  }

  /** Create payload for a manual (non-DCR) template's org-owned custom server. */
  function manualCreateInput(template: McpTemplate) {
    return {
      name: template.name,
      endpoint: template.endpoint,
      auth: 'oauth' as const,
      description: template.description,
      icon: template.icon ?? undefined,
      returnTo: `/app/settings/apps/mcp/${template.id}`,
    }
  }

  /**
   * Manual templates, stage 1: eagerly save the org server (no creds) so its per-server
   * callback URL exists — the provider needs it to register an OAuth app. Idempotent per
   * endpoint, so a half-done setup is picked back up with the same URL.
   */
  async function handleGenerateManual(template: McpTemplate) {
    setConnectingId(template.id)
    try {
      const result = await createServer.mutateAsync(manualCreateInput(template))
      if ('needsClientCredentials' in result && result.needsClientCredentials) {
        setManualSetup({ redirectUri: result.redirectUri, slug: result.slug })
        onConnected() // the saved server is now visible in the list
        setConnectingId(null)
        return
      }
      if ('needsOAuth' in result && result.needsOAuth) {
        // The reused server already has client creds → straight to the popup.
        oauth.open({
          authorizeUrl: result.authorizeUrl,
          verifyServer: { serverId: result.serverId, endpoint: template.endpoint },
          onDone: (ok) => {
            if (ok) handleConnected(result.slug)
            else setConnectingId(null)
          },
        })
        return
      }
      handleConnected(result.slug)
    } catch (err) {
      setConnectingId(null)
      toastError({
        title: 'Failed to save server',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  /** Manual templates, stage 2: pasted creds → connect (reuses the saved server) → popup. */
  async function handleConnectManual(template: McpTemplate) {
    const next: Record<string, string> = {}
    if (!manualClientId.trim()) next.manualClientId = 'Client ID is required'
    if (template.clientSecretRequired && !manualClientSecret.trim()) {
      next.manualClientSecret = `${template.name} requires a client secret`
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setConnectingId(template.id)
    try {
      const result = await createServer.mutateAsync({
        ...manualCreateInput(template),
        oauth: {
          clientId: manualClientId.trim(),
          clientSecret: manualClientSecret.trim() || undefined,
        },
      })
      if ('needsOAuth' in result && result.needsOAuth) {
        oauth.open({
          authorizeUrl: result.authorizeUrl,
          verifyServer: { serverId: result.serverId, endpoint: template.endpoint },
          onDone: (ok) => {
            if (ok) handleConnected(result.slug)
            else setConnectingId(null)
          },
        })
        return
      }
      handleConnected(result.slug)
    } catch (err) {
      setConnectingId(null)
      toastError({
        title: 'Failed to connect',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return (
    <TemplateGalleryDialog<McpTemplate>
      open={open}
      onOpenChange={onOpenChange}
      title='Connect from template'
      description='Select an MCP server template to connect'
      crumbLabel='MCP templates'
      crumbIcon={<Plug />}
      items={templates}
      isLoading={catalog.isLoading}
      categories={categories}
      renderIcon={(template) => (
        <div className='flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background'>
          {template.icon?.iconId ? (
            <AppIcon iconId={template.icon.iconId} size='sm' />
          ) : (
            <Plug className='size-4 text-muted-foreground' />
          )}
        </div>
      )}
      renderBadges={(template) => {
        if (serverFor(template)?.connectionPresent) {
          return (
            <Badge variant='secondary' className='text-xs'>
              Connected
            </Badge>
          )
        }
        return template.categories.map((cat) => (
          <Badge key={cat} variant='outline' className='text-xs'>
            {categories.find((c) => c.value === cat)?.label ?? cat}
          </Badge>
        ))
      }}
      onSelectItem={handleSelectTemplate}
      busyItemId={connectingId}
      detailSize='sm'
      detailCrumb={(template) => `Connect ${template.name}`}
      detailBusy={isSubmitting}
      onDetailExit={resetFields}
      renderDetail={(template) =>
        template.clientRegistration === 'manual'
          ? renderManualSetup(template)
          : renderVariableFields(template)
      }
      renderDetailFooter={(template) =>
        template.clientRegistration === 'manual' ? (
          manualSetup ? (
            <Button
              size='sm'
              variant='outline'
              onClick={() => handleConnectManual(template)}
              loading={isSubmitting}
              loadingText='Connecting...'
              data-dialog-submit>
              Connect <KbdSubmit variant='outline' size='sm' />
            </Button>
          ) : (
            <Button
              size='sm'
              variant='outline'
              onClick={() => handleGenerateManual(template)}
              loading={isSubmitting}
              loadingText='Saving...'
              data-dialog-submit>
              Generate callback URL <KbdSubmit variant='outline' size='sm' />
            </Button>
          )
        ) : (
          <Button
            size='sm'
            variant='outline'
            onClick={() => handleSubmitFields(template)}
            loading={isSubmitting}
            loadingText='Connecting...'
            data-dialog-submit>
            Connect <KbdSubmit variant='outline' size='sm' />
          </Button>
        )
      }
    />
  )

  /**
   * Manual (non-DCR) template setup, all in the detail step: generate the callback URL (saves
   * the server), register an OAuth app at the provider with it, paste the creds, connect.
   */
  function renderManualSetup(template: McpTemplate) {
    return (
      <div className='flex flex-col gap-3 p-3 text-sm'>
        {template.setupHint && <p>{template.setupHint}</p>}
        {!manualSetup ? (
          <p className='text-muted-foreground'>
            Generate the callback URL first — you'll need it to register the OAuth app.
          </p>
        ) : (
          <>
            <div className='flex flex-col gap-1'>
              <span className='text-muted-foreground text-xs'>
                Set this as the OAuth app's authorization callback URL:
              </span>
              <div className='flex items-center gap-1'>
                <code className='break-all rounded-md border bg-muted px-2 py-1 font-mono text-xs'>
                  {manualSetup.redirectUri}
                </code>
                <CopyButton text={manualSetup.redirectUri} />
              </div>
              {template.createOAuthAppUrl && (
                <a
                  href={buildCreateOAuthAppUrl(template.createOAuthAppUrl, manualSetup.redirectUri)}
                  target='_blank'
                  rel='noreferrer'
                  className='self-start text-xs underline underline-offset-2'>
                  Create the OAuth app on {template.name}
                </a>
              )}
            </div>
            <VarEditorField
              orientation='responsive'
              className='p-0 sm:[&_[data-slot=field-row-label]]:w-40'>
              <VarEditorFieldRow
                title='Client ID'
                type={BaseType.STRING}
                showIcon
                isRequired
                validationError={errors.manualClientId}>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={manualClientId}
                  onChange={(v) => setManualClientId((v as string) ?? '')}
                  placeholder='From your OAuth app'
                  disabled={isSubmitting}
                />
              </VarEditorFieldRow>
              <VarEditorFieldRow
                title='Client Secret'
                type={BaseType.STRING}
                showIcon
                isRequired={template.clientSecretRequired}
                validationError={errors.manualClientSecret}>
                <FieldInputAdapter
                  fieldType={FieldType.TEXT}
                  value={manualClientSecret}
                  onChange={(v) => setManualClientSecret((v as string) ?? '')}
                  placeholder={
                    template.clientSecretRequired
                      ? 'Required by this provider'
                      : 'Optional for public clients'
                  }
                  disabled={isSubmitting}
                />
              </VarEditorFieldRow>
            </VarEditorField>
          </>
        )}
        {template.docsUrl && (
          <a
            href={template.docsUrl}
            target='_blank'
            rel='noreferrer'
            className='self-start text-xs text-muted-foreground underline-offset-2 hover:underline'>
            View the {template.name} docs
          </a>
        )}
      </div>
    )
  }

  function renderVariableFields(template: McpTemplate) {
    return (
      <div className='flex flex-col gap-2 p-3'>
        <VarEditorField
          orientation='responsive'
          className='p-0 sm:[&_[data-slot=field-row-label]]:w-40'>
          <ConnectionVariableFields
            variables={template.connectionVariables ?? []}
            values={values}
            onValueChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
            showToken={template.connectionType === 'secret'}
            token={token}
            onTokenChange={setToken}
            errors={errors}
            disabled={isSubmitting}
          />
        </VarEditorField>
        {template.docsUrl && (
          <a
            href={template.docsUrl}
            target='_blank'
            rel='noreferrer'
            className='self-start text-xs text-muted-foreground underline-offset-2 hover:underline'>
            Where do I find this? View the {template.name} docs
          </a>
        )}
      </div>
    )
  }
}
