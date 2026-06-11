// apps/web/src/components/mcp/ui/mcp-template-dialog.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Dialog, DialogContent, DialogFooter } from '@auxx/ui/components/dialog'
import { DialogNav, DialogNavPage, DialogNavPages } from '@auxx/ui/components/dialog-nav'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@auxx/ui/components/empty'
import { InputSearch } from '@auxx/ui/components/input-search'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import {
  Code,
  LayoutGrid,
  ListTodo,
  type LucideIcon,
  Plug,
  Search,
  ShoppingCart,
  Zap,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import { VarEditorField } from '~/components/workflow/ui/input-editor/var-editor'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { useMcpOAuthPopup } from '../hooks/use-mcp-oauth-popup'
import { useMcpServers } from '../hooks/use-mcp-servers'
import { ConnectionVariableFields } from './connection-variable-fields'

type McpTemplate = RouterOutputs['mcp']['listTemplates']['templates'][number]

/** Sidebar category icons — keep in sync with `mcpTemplateCategories` in @auxx/lib. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  LayoutGrid,
  Code,
  ListTodo,
  ShoppingCart,
  Search,
  Zap,
}

interface McpTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful connect (or OAuth popup completion). */
  onConnected: () => void
}

/**
 * "Connect from template" dialog for Settings → Apps. Mirrors the agent-template dialog's
 * list view (category sidebar + search); the catalog comes from `mcp.listTemplates` (never
 * bundled client-side). Clicking a template connects one-click: OAuth goes straight to the
 * popup; templates needing connection variables or a token get an inline fields step.
 * Already-connected templates show a badge and route to the server's detail page instead.
 */
export function McpTemplateDialog({ open, onOpenChange, onConnected }: McpTemplateDialogProps) {
  const router = useRouter()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [step, setStep] = useState<'list' | 'fields'>('list')
  const [active, setActive] = useState<McpTemplate | null>(null)
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

  const filteredTemplates = useMemo(() => {
    let list = templates
    if (selectedCategory !== 'all') {
      list = list.filter((t) => (t.categories as string[]).includes(selectedCategory))
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
      )
    }
    return list
  }, [templates, searchQuery, selectedCategory])

  function reset() {
    setSearchQuery('')
    setSelectedCategory('all')
    setStep('list')
    setActive(null)
    setConnectingId(null)
    setValues({})
    setToken('')
    setErrors({})
  }

  function close() {
    reset()
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

  async function handleSelectTemplate(template: McpTemplate) {
    if (isSubmitting || connectingId) return

    const existing = serverFor(template)
    if (existing?.connectionPresent) {
      close()
      router.push(`/app/settings/apps/mcp/${existing.slug}`)
      return
    }

    const needsFields =
      (template.connectionVariables?.length ?? 0) > 0 || template.connectionType === 'secret'
    if (needsFields) {
      setActive(template)
      setValues({})
      setToken('')
      setErrors({})
      setStep('fields')
      return
    }

    setConnectingId(template.id)
    await connect(template)
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

  async function handleSubmitFields() {
    if (!active || !validateFields(active)) return
    setConnectingId(active.id)
    await connect(active, values, token)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent
        innerClassName='p-0'
        position='tc'
        size='content'
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          searchInputRef.current?.focus()
        }}>
        <div className='flex flex-col'>
          <DialogNav
            title='Connect from template'
            description='Select an MCP server template to connect'
            onBack={step === 'fields' ? () => setStep('list') : undefined}
            backDisabled={isSubmitting}
            crumbs={[
              step === 'fields' && active
                ? { label: `Connect ${active.name}`, icon: <Plug /> }
                : { label: 'MCP templates', icon: <Plug /> },
            ]}
          />

          <DialogNavPages value={step}>
            <DialogNavPage value='list' size='3xl'>
              {renderList()}
            </DialogNavPage>
            <DialogNavPage value='fields' size='sm'>
              <div className='p-3'>{active && renderFields(active)}</div>
            </DialogNavPage>
          </DialogNavPages>

          <DialogFooter className='mt-0 border-t p-3'>
            <Button size='sm' variant='ghost' onClick={close} disabled={isSubmitting}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            {step === 'fields' && (
              <Button
                size='sm'
                variant='outline'
                onClick={handleSubmitFields}
                loading={isSubmitting}
                loadingText='Connecting...'
                data-dialog-submit>
                Connect <KbdSubmit variant='outline' size='sm' />
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )

  function renderList() {
    return (
      <div className='flex flex-col sm:flex-row justify-start w-full min-h-0'>
        {/* Category sidebar */}
        <div className='hidden sm:flex w-56 border-r bg-muted/30 flex-col'>
          <ScrollArea className='max-h-[440px]'>
            <h3 className='p-3 pb-0 text-sm font-semibold text-muted-foreground sticky top-0'>
              Categories
            </h3>
            <div className='p-3'>
              <RadioGroup value={selectedCategory} onValueChange={setSelectedCategory}>
                {categories.map((category) => {
                  const count =
                    category.value === 'all'
                      ? templates.length
                      : templates.filter((t) => (t.categories as string[]).includes(category.value))
                          .length
                  const Icon = CATEGORY_ICONS[category.icon]
                  return (
                    <RadioGroupItemCard
                      key={category.value}
                      label={category.label}
                      value={category.value}
                      description={`${count} template${count !== 1 ? 's' : ''}`}
                      icon={Icon ? <Icon /> : undefined}
                    />
                  )
                })}
              </RadioGroup>
            </div>
          </ScrollArea>
        </div>

        {/* Template list */}
        <div className='flex-1 overflow-hidden flex flex-col min-w-0'>
          <div className='py-3 px-3'>
            <InputSearch
              ref={searchInputRef}
              placeholder='Search templates...'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onClear={() => setSearchQuery('')}
            />
          </div>

          {catalog.isLoading ? (
            <div className='p-3 pt-0 space-y-2'>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className='h-14 rounded-2xl border bg-muted/40 animate-pulse' />
              ))}
            </div>
          ) : filteredTemplates.length > 0 ? (
            <ScrollArea className='max-h-[400px]'>
              <div className='p-3 pt-0 space-y-2'>
                {filteredTemplates.map((template) => renderRow(template))}
              </div>
            </ScrollArea>
          ) : (
            <Empty className='py-10'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Search />
                </EmptyMedia>
                <EmptyTitle>No templates found</EmptyTitle>
                <EmptyDescription>
                  {searchQuery
                    ? 'No templates match your search. Try adjusting your query.'
                    : 'No templates available in this category.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </div>
    )
  }

  function renderRow(template: McpTemplate) {
    const isConnected = !!serverFor(template)?.connectionPresent
    const isConnecting = connectingId === template.id
    const isAnyConnecting = connectingId !== null
    return (
      <button
        type='button'
        key={template.id}
        onClick={() => handleSelectTemplate(template)}
        disabled={isAnyConnecting && !isConnected}
        className={cn(
          'group flex items-center justify-between gap-3 rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200 cursor-pointer text-left w-full',
          isAnyConnecting && !isConnecting && 'opacity-50 cursor-default',
          isConnecting && 'bg-muted'
        )}>
        <div className='flex items-start gap-3 flex-1 min-w-0'>
          <div className='size-8 rounded-lg border bg-background flex items-center justify-center shrink-0'>
            {template.icon?.iconId ? (
              <AppIcon iconId={template.icon.iconId} size='sm' />
            ) : (
              <Plug className='size-4 text-muted-foreground' />
            )}
          </div>
          <div className='flex flex-col flex-1 min-w-0'>
            <span className='text-sm font-medium truncate'>{template.name}</span>
            <span className='text-xs text-muted-foreground line-clamp-1 mt-0.5'>
              {template.description}
            </span>
          </div>
        </div>
        <div className='flex gap-1 shrink-0'>
          {isConnected ? (
            <Badge variant='secondary' className='text-xs'>
              Connected
            </Badge>
          ) : (
            template.categories.map((cat) => (
              <Badge key={cat} variant='outline' className='text-xs'>
                {categories.find((c) => c.value === cat)?.label ?? cat}
              </Badge>
            ))
          )}
        </div>
      </button>
    )
  }

  function renderFields(template: McpTemplate) {
    return (
      <div className='flex flex-col gap-2'>
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
            className='self-start text-muted-foreground text-xs underline-offset-2 hover:underline'>
            Where do I find this? View the {template.name} docs
          </a>
        )}
      </div>
    )
  }
}
