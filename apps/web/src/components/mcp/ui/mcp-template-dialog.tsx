// apps/web/src/components/mcp/ui/mcp-template-dialog.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { Plug } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { TemplateGalleryDialog } from '~/components/templates/ui'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { useMcpOAuthPopup } from '../hooks/use-mcp-oauth-popup'
import { useMcpServers } from '../hooks/use-mcp-servers'
import { ConnectionVariableFields } from './connection-variable-fields'

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

  const catalog = api.mcp.listTemplates.useQuery(undefined, { enabled: open })
  const connectTemplate = api.mcp.connectTemplate.useMutation()
  const oauth = useMcpOAuthPopup()
  const { servers } = useMcpServers()

  const templates = useMemo(() => catalog.data?.templates ?? [], [catalog.data])
  const categories = catalog.data?.categories ?? []
  const isSubmitting = connectTemplate.isPending || oauth.pending

  /** Connected (or browsable) server matching a template, by slug. */
  const serverFor = (template: McpTemplate) => servers.find((s) => s.slug === template.id)

  function resetFields() {
    setConnectingId(null)
    setValues({})
    setToken('')
    setErrors({})
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
      renderDetail={(template) => (
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
      )}
      renderDetailFooter={(template) => (
        <Button
          size='sm'
          variant='outline'
          onClick={() => handleSubmitFields(template)}
          loading={isSubmitting}
          loadingText='Connecting...'
          data-dialog-submit>
          Connect <KbdSubmit variant='outline' size='sm' />
        </Button>
      )}
    />
  )
}
