// apps/web/src/components/pickers/channel-picker.tsx
'use client'

import type { ChannelSelectionScope } from '@auxx/lib/channels/client'
import type { SelectOption } from '@auxx/types/custom-field'
import { Badge } from '@auxx/ui/components/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { Star } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDefaultChannelId } from '~/components/channels/hooks/use-default-channel'
import { useSendableChannels } from '~/components/channels/store/channel-store'
import { Tooltip } from '~/components/global/tooltip'
import { PickerTrigger, type PickerTriggerOptions } from '~/components/ui/picker-trigger'
import { useSettings } from '~/hooks/use-settings'
import { MultiSelectPicker } from './multi-select-picker'

interface ChannelPickerProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /**
   * Which channels to offer. Defaults to `'email'` so every existing caller
   * (sequences, quotes/invoices, dispatch notifications) keeps its behaviour —
   * those surfaces build a subject + HTML body and cannot degrade to SMS.
   * The mail composer passes `'addressable'` to include phone channels.
   */
  scope?: ChannelSelectionScope
  /** Styling for the shared picker trigger. */
  triggerProps?: PickerTriggerOptions
  /** className forwarded to PopoverContent (e.g. for z-index override) */
  className?: string
}

/**
 * What the user sees in the From row: the address the message will come FROM.
 *
 * `identifier` is the server-resolved sending identity (`channels/internal/
 * identifier.ts`) — email for mail channels, `metadata.phoneNumber` for
 * Quo/SMS, widget name for chat. Reading `email` first, as this did, renders an
 * empty badge for a phone channel: an SMS `Integration` carries no `email`, and
 * `name` is null on a channel the user never renamed.
 */
function channelLabel(channel: { identifier?: string; email?: string; name: string | null }) {
  return channel.identifier || channel.email || channel.name || 'Unnamed channel'
}

export function ChannelPicker({
  value,
  onChange,
  disabled,
  scope = 'email',
  triggerProps,
  className,
}: ChannelPickerProps) {
  const router = useRouter()
  const allChannels = useSendableChannels(scope)
  // Example integrations are seeded placeholders — they can't actually send.
  // See plans/seeding/example-data-for-new-accounts.md §7a.
  const channels = useMemo(() => allChannels.filter((c) => !c.isExample), [allChannels])

  const { getSetting, updateUserSetting } = useSettings({})
  const defaultChannelId = getSetting('compose.defaultIntegrationId') as string | null
  const resolvedDefault = useDefaultChannelId(scope)

  const [open, setOpen] = useState(false)

  // Fallback: if the editor opened before channels hydrated, fill in the
  // resolved default once it's available. Fires at most once per mount — some
  // consumers persist onChange asynchronously (value stays empty until the
  // save lands), and re-firing per render would loop the mutation.
  const autoFilledDefault = useRef(false)
  useEffect(() => {
    if (autoFilledDefault.current) return
    if (!value && resolvedDefault) {
      autoFilledDefault.current = true
      onChange(resolvedDefault)
    }
  }, [value, resolvedDefault, onChange])

  const options = useMemo<SelectOption[]>(
    () =>
      channels.map((c) => ({
        value: c.id,
        label: channelLabel(c),
      })),
    [channels]
  )

  if (channels.length === 0) {
    return <div className='text-sm text-muted-foreground'>No channels available</div>
  }

  const selected = channels.find((c) => c.id === value)
  const displayName = selected ? channelLabel(selected) : 'Select channel'

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return
        setOpen(next)
      }}>
      <PopoverTrigger asChild>
        <PickerTrigger
          open={open}
          disabled={disabled}
          variant={triggerProps?.variant ?? 'transparent'}
          size={triggerProps?.size}
          hasValue={!!selected}
          placeholder='Select channel'
          icon={triggerProps?.icon}
          iconPosition={triggerProps?.iconPosition}
          hideIcon={triggerProps?.hideIcon}
          asCombobox
          className={triggerProps?.className}>
          <Badge variant='user'>{displayName}</Badge>
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContent className={cn('w-auto min-w-[240px] p-0', className)}>
        <MultiSelectPicker
          options={options}
          value={value}
          onChange={() => {}}
          onSelectSingle={(v) => {
            onChange(v)
            setOpen(false)
          }}
          multi={false}
          canManage={false}
          canAdd={false}
          placeholder='Search channels...'
          disabled={disabled}
          onBrowse={() => {
            setOpen(false)
            router.push('/app/settings/channels')
          }}
          browseLabel='Manage channels'
          renderItemAction={(opt) => {
            const isDefault = opt.value === defaultChannelId
            return (
              <Tooltip content={isDefault ? 'Default channel' : 'Make default'}>
                <button
                  type='button'
                  aria-label={isDefault ? 'Default channel' : 'Make default'}
                  className={cn(
                    'flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-primary-200',
                    !isDefault && 'opacity-0 group-hover/item:opacity-100'
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    updateUserSetting('compose.defaultIntegrationId', opt.value)
                  }}>
                  <Star className={cn('size-3', isDefault && 'fill-yellow-400 text-yellow-400')} />
                </button>
              </Tooltip>
            )
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
