// apps/web/src/components/pickers/channel-picker.tsx
'use client'

import type { SelectOption } from '@auxx/types/custom-field'
import { Badge } from '@auxx/ui/components/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { cn } from '@auxx/ui/lib/utils'
import { ChevronsUpDown, Star } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useDefaultChannelId } from '~/components/channels/hooks/use-default-channel'
import { useEmailChannels } from '~/components/channels/store/channel-store'
import { Tooltip } from '~/components/global/tooltip'
import { useSettings } from '~/hooks/use-settings'
import { MultiSelectPicker } from './multi-select-picker'

interface ChannelPickerProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** className forwarded to PopoverContent (e.g. for z-index override) */
  className?: string
}

export function ChannelPicker({ value, onChange, disabled, className }: ChannelPickerProps) {
  const router = useRouter()
  const allChannels = useEmailChannels()
  // Example integrations are seeded placeholders — they can't actually send.
  // See plans/seeding/example-data-for-new-accounts.md §7a.
  const channels = useMemo(() => allChannels.filter((c) => !c.isExample), [allChannels])

  const { getSetting, updateUserSetting } = useSettings({})
  const defaultChannelId = getSetting('compose.defaultIntegrationId') as string | null
  const resolvedDefault = useDefaultChannelId()

  const [open, setOpen] = useState(false)

  // Fallback: if the editor opened before channels hydrated, fill in the
  // resolved default once it's available.
  useEffect(() => {
    if (!value && resolvedDefault) {
      onChange(resolvedDefault)
    }
  }, [value, resolvedDefault, onChange])

  const options = useMemo<SelectOption[]>(
    () =>
      channels.map((c) => ({
        value: c.id,
        label: c.email || c.name,
      })),
    [channels]
  )

  if (channels.length === 0) {
    return <div className='text-sm text-muted-foreground'>No channels available</div>
  }

  const selected = channels.find((c) => c.id === value)
  const displayName = selected ? selected.email || selected.name : 'Select channel'

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return
        setOpen(next)
      }}>
      <PopoverTrigger asChild disabled={disabled}>
        <div className='inline-block'>
          <Badge
            variant='user'
            className={disabled ? 'cursor-not-allowed opacity-70' : ''}
            role='combobox'
            aria-expanded={open}
            aria-label='Select channel'
            onClick={(e) => {
              if (disabled) return
              e.preventDefault()
              setOpen(!open)
            }}>
            {displayName}
            <ChevronsUpDown
              className={`ml-1 h-3 w-3 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </Badge>
        </div>
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
