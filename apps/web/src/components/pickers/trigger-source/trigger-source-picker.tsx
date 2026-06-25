// apps/web/src/components/pickers/trigger-source/trigger-source-picker.tsx
// Presentational, popover-friendly trigger list (unified-trigger-picker §2.2, popover variant).
// A `cmdk` Command list with two grouped sections — installed-app webhook triggers (APPS) and
// generic inbound WebhookEndpoints (WEBHOOK ENDPOINTS) — that returns the discriminated
// `TriggerSource` the caller chose. Knows nothing about its host chrome; the popover wrapper
// (`trigger-source-picker-popover.tsx`) owns the data query + Popover, mirroring ConnectionPicker.

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import { Check, Webhook } from 'lucide-react'
import type { ReactNode } from 'react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import type {
  AppTriggerSource,
  TriggerSource,
  WebhookEndpointSource,
  WebhookEndpointSummary,
} from './use-trigger-sources'

interface TriggerSourceListProps {
  appSources: AppTriggerSource[]
  endpointSources: WebhookEndpointSource[]
  isLoading: boolean
  onSelect: (source: TriggerSource) => void
  /** Marks the currently-bound row with a check. The caller owns the selection. */
  isSelected?: (source: TriggerSource) => boolean
  /** Hover-revealed Edit on endpoint rows → opens the endpoint config dialog. */
  onEditEndpoint?: (endpoint: WebhookEndpointSummary) => void
  /** Where to link when the org has no endpoints yet (the "create" affordance). */
  manageEndpointsHref?: string
}

/**
 * Two grouped, searchable sections. `cmdk` owns the fuzzy filtering (via each item's
 * `value`/`keywords`); picking a row fires `onSelect` with the discriminated source and the
 * caller owns the follow-up (topic sub-pick, token editor, persist).
 */
export function TriggerSourceList({
  appSources,
  endpointSources,
  isLoading,
  onSelect,
  isSelected,
  onEditEndpoint,
  manageEndpointsHref,
}: TriggerSourceListProps) {
  const isEmpty = !isLoading && appSources.length === 0 && endpointSources.length === 0
  const isLoadingCold = isLoading && appSources.length === 0 && endpointSources.length === 0

  return (
    <Command className='w-full'>
      {!isEmpty && !isLoadingCold && <CommandInput placeholder='Search triggers...' />}
      <CommandList scrollAreaClassName='max-h-80'>
        {isLoadingCold && (
          <div className='px-3 py-6 text-center text-sm text-muted-foreground'>Loading…</div>
        )}

        {isEmpty && (
          <div className='px-3 py-6 text-center text-sm text-muted-foreground'>
            No app triggers or webhook endpoints yet.
          </div>
        )}

        {!isEmpty && !isLoadingCold && <CommandEmpty>No triggers found.</CommandEmpty>}

        {appSources.length > 0 && (
          <CommandGroup heading='Apps'>
            {appSources.map((s) => (
              <TriggerSourceItem
                key={`${s.installation.installationId}:${s.trigger.triggerId}`}
                value={`${s.trigger.label} ${s.installation.app.title} ${s.trigger.triggerId}`}
                icon={<AppIcon iconId={s.installation.app.avatarUrl ?? 'package'} size='sm' />}
                label={s.trigger.label}
                subtitle={s.installation.app.title}
                selected={isSelected?.(s) ?? false}
                onSelect={() => onSelect(s)}
              />
            ))}
          </CommandGroup>
        )}

        {!isEmpty && (endpointSources.length > 0 || !isLoading) && (
          <CommandGroup heading='Webhook endpoints'>
            {endpointSources.length > 0 ? (
              endpointSources.map((s) => (
                <TriggerSourceItem
                  key={s.endpoint.id}
                  value={`${s.endpoint.name} ${s.endpoint.id}`}
                  icon={<Webhook className='size-4 text-muted-foreground' />}
                  label={s.endpoint.name}
                  subtitle={`${s.endpoint.verification} verification`}
                  selected={isSelected?.(s) ?? false}
                  onSelect={() => onSelect(s)}
                  onEdit={onEditEndpoint ? () => onEditEndpoint(s.endpoint) : undefined}
                />
              ))
            ) : (
              <EmptyEndpoints href={manageEndpointsHref} />
            )}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}

function TriggerSourceItem({
  value,
  icon,
  label,
  subtitle,
  selected,
  onEdit,
  onSelect,
}: {
  value: string
  icon: ReactNode
  label: string
  subtitle?: string
  selected: boolean
  onEdit?: () => void
  onSelect: () => void
}) {
  return (
    <CommandItem value={value} onSelect={onSelect} className='group cursor-pointer h-8 gap-2'>
      <span className='flex size-5 shrink-0 items-center justify-center'>{icon}</span>
      <span className='shrink-0'>{label}</span>
      {subtitle && (
        <span className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>{subtitle}</span>
      )}
      <div className='ml-auto flex shrink-0 items-center gap-1.5 pl-2'>
        {onEdit && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-6 px-2 opacity-0 transition-opacity group-hover:opacity-100 group-data-[selected=true]:opacity-100'
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}>
            Edit
          </Button>
        )}
        {selected && (
          <div className='flex size-4 shrink-0 items-center justify-center rounded-full border border-blue-800 bg-info'>
            <Check className='size-2.5! text-white' strokeWidth={4} />
          </div>
        )}
      </div>
    </CommandItem>
  )
}

function EmptyEndpoints({ href }: { href?: string }) {
  return (
    <div className='flex flex-col items-center gap-2 px-2 py-4 text-center'>
      <Webhook className='size-5 text-muted-foreground' />
      <p className='text-sm text-muted-foreground'>No webhook endpoints yet.</p>
      {href && (
        <Button variant='outline' size='sm' asChild>
          <a href={href}>Create a webhook endpoint</a>
        </Button>
      )}
    </div>
  )
}
