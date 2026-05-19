// apps/web/src/components/apps/ui/app-account-popover.tsx
'use client'

import { Popover, PopoverContentDialogAware, PopoverTrigger } from '@auxx/ui/components/popover'
import { useMemo, useState } from 'react'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { useExtensionsContext } from '~/providers/extensions/extensions-context'
import { AppAccountPicker } from './app-account-picker'
import { AppIcon } from './app-icon'

interface AppAccountPopoverProps {
  /** App id (slug) the popover is bound to. */
  appId: string | null
  /** Currently-selected credId(s). Renders as the trigger's value when single. */
  value: string | string[] | undefined
  /** Fires once per pick with the picked credId. Host decides single vs multi semantics. */
  onPick: (credId: string) => void
  /** Fires when the connect flow returns a new credential. */
  onConnected?: (credId: string) => void
  /** Trigger placeholder when no value is selected. */
  placeholder?: string
  /** Override the trigger button. Defaults to a compact `PickerTrigger`. */
  triggerClassName?: string
}

/**
 * Popover-wrapped account picker. The `PickerTrigger` shows the bound
 * credential's label (or placeholder), and the popover content renders the
 * `<Command>`-based `AppAccountPicker`.
 *
 * See plans/kopilot/apps/app-account-picker-command-refactor.md §2.
 */
export function AppAccountPopover({
  appId,
  value,
  onPick,
  onConnected,
  placeholder = 'Choose account',
  triggerClassName,
}: AppAccountPopoverProps) {
  const [open, setOpen] = useState(false)
  const { appConnections, appInstallations } = useExtensionsContext()

  const triggerLabel = useMemo(() => {
    if (!value || Array.isArray(value)) return null
    const cred = appConnections.find((c) => c.id === value)
    return cred?.label ?? cred?.appName ?? null
  }, [value, appConnections])

  const avatarUrl = useMemo(() => {
    if (!appId) return null
    return appInstallations.find((i) => i.app.id === appId)?.app.avatarUrl ?? null
  }, [appInstallations, appId])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PickerTrigger
          open={open}
          hasValue={!!triggerLabel}
          placeholder={placeholder}
          size='default'
          variant='outline'
          className={triggerClassName}>
          {avatarUrl && <AppIcon iconId={avatarUrl} size='sm' />}
          <span className='truncate'>{triggerLabel}</span>
        </PickerTrigger>
      </PopoverTrigger>
      <PopoverContentDialogAware className='w-72 p-0' align='start'>
        <AppAccountPicker
          appId={appId}
          value={value}
          onPick={(credId) => {
            onPick(credId)
            setOpen(false)
          }}
          onConnected={onConnected}
        />
      </PopoverContentDialogAware>
    </Popover>
  )
}
