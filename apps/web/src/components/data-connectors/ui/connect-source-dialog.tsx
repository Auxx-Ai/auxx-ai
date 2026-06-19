// apps/web/src/components/data-connectors/ui/connect-source-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { Boxes, CreditCard, Database, Github, Globe, Plug } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ComponentType, useState } from 'react'
import { api } from '~/trpc/react'

interface ConnectSourceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Map a catalog `iconKey` to a lucide icon (server sends a stable key, not a component). */
const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  globe: Globe,
  'credit-card': CreditCard,
  github: Github,
  database: Database,
}
function iconFor(key: string | null | undefined): ComponentType<{ className?: string }> {
  return (key && ICONS[key]) || Boxes
}

/**
 * "Connect a source" picker (05c §6). Lists the full catalog from
 * `dataConnector.catalog`: the blank built-in REST connector, first-party
 * templates (pre-filled generic-rest presets), and installed-app connectors.
 * Picking any row creates the connector and routes into its detail view.
 */
export function ConnectSourceDialog({ open, onOpenChange }: ConnectSourceDialogProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const [name, setName] = useState('')

  const catalog = api.dataConnector.catalog.useQuery(undefined, { enabled: open })

  const create = api.dataConnector.create.useMutation({
    onSuccess: (connector) => {
      void utils.dataConnector.list.invalidate()
      onOpenChange(false)
      setName('')
      router.push(`/app/connectors/${connector.id}`)
    },
    onError: (e) => toastError({ title: 'Could not create connector', description: e.message }),
  })

  const createBlankRest = () => {
    create.mutate({ name: name.trim() || 'New REST source', type: 'generic-rest' })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='lg' position='tc'>
        <DialogHeader>
          <DialogTitle>Connect a source</DialogTitle>
          <DialogDescription>
            Sync external structured records into your entity system.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className='max-h-[60vh]' scrollbarClassName='w-1.5'>
          <div className='flex flex-col gap-5 pr-2'>
            {/* Blank REST — name it inline, then configure in the detail view. */}
            <section className='flex flex-col gap-2'>
              <SectionLabel>Custom</SectionLabel>
              <div className='flex flex-col gap-2 rounded-lg border p-4'>
                <div className='flex items-center gap-2'>
                  <span className='flex size-8 items-center justify-center rounded-lg border'>
                    <Globe className='size-4' />
                  </span>
                  <div className='flex flex-col'>
                    <span className='text-sm font-medium'>Custom REST API</span>
                    <span className='text-xs text-muted-foreground'>
                      Connect any HTTP/JSON endpoint — you define the request and mappings.
                    </span>
                  </div>
                </div>
                <div className='flex items-center gap-2'>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder='Source name (e.g. Acme CRM)'
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createBlankRest()
                    }}
                  />
                  <Button
                    size='sm'
                    variant='outline'
                    loading={create.isPending}
                    loadingText='Creating...'
                    onClick={createBlankRest}>
                    Create
                  </Button>
                </div>
              </div>
            </section>

            {/* Templates — pre-filled generic-rest presets. */}
            {(catalog.data?.templates.length ?? 0) > 0 && (
              <section className='flex flex-col gap-2'>
                <SectionLabel>Templates</SectionLabel>
                <div className='grid grid-cols-2 gap-2'>
                  {catalog.data?.templates.map((t) => {
                    const Icon = iconFor(t.iconKey)
                    return (
                      <CatalogRow
                        key={t.id}
                        icon={<Icon className='size-4' />}
                        title={t.name}
                        subtitle={t.description}
                        hint={t.requiresConnection ? 'Needs a connection' : undefined}
                        disabled={create.isPending}
                        onClick={() =>
                          create.mutate({ name: t.name, type: 'generic-rest', templateId: t.id })
                        }
                      />
                    )
                  })}
                </div>
              </section>
            )}

            {/* Installed-app connectors. */}
            {(catalog.data?.apps.length ?? 0) > 0 && (
              <section className='flex flex-col gap-2'>
                <SectionLabel>Apps</SectionLabel>
                <div className='grid grid-cols-2 gap-2'>
                  {catalog.data?.apps.map((a) => {
                    const Icon = iconFor(a.iconKey)
                    return (
                      <CatalogRow
                        key={`${a.type}:${a.connectorId}`}
                        icon={<Icon className='size-4' />}
                        title={a.label}
                        hint={a.requiresConnection ? 'Needs a connection' : undefined}
                        disabled={create.isPending}
                        onClick={() => create.mutate({ name: a.label, type: a.type })}
                      />
                    )
                  })}
                </div>
              </section>
            )}

            {!catalog.isLoading &&
              (catalog.data?.templates.length ?? 0) === 0 &&
              (catalog.data?.apps.length ?? 0) === 0 && (
                <div className='rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground'>
                  No templates or app connectors available yet — start with a custom REST source.
                </div>
              )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
      {children}
    </span>
  )
}

function CatalogRow({
  icon,
  title,
  subtitle,
  hint,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  hint?: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={onClick}
      className='flex flex-col gap-1.5 rounded-lg border bg-background p-3 text-left hover:bg-primary-50/50 disabled:opacity-60'>
      <div className='flex items-center gap-2'>
        <span className='flex size-8 shrink-0 items-center justify-center rounded-lg border'>
          {icon}
        </span>
        <span className='text-sm font-medium'>{title}</span>
      </div>
      {subtitle && <span className='line-clamp-2 text-xs text-muted-foreground'>{subtitle}</span>}
      {hint && (
        <span className='flex items-center gap-1 text-[11px] text-muted-foreground'>
          <Plug className='size-3' />
          {hint}
        </span>
      )}
    </button>
  )
}
