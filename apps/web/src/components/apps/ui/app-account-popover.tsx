// apps/web/src/components/apps/ui/app-account-popover.tsx
'use client'

import { Popover, PopoverContentDialogAware, PopoverTrigger } from '@auxx/ui/components/popover'
import { type ReactNode, useMemo, useState } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { PickerTrigger } from '~/components/ui/picker-trigger'
import { AppAccountPicker } from './app-account-picker'
import { AppIcon } from './app-icon'
import { AppSettingsDialog } from './app-settings-dialog'

interface AppAccountPopoverProps {
  /** App id (slug) the popover is bound to. */
  appId: string | null
  /** Currently-selected credId(s). Renders as the trigger's value when single. */
  value: string | string[] | undefined
  /** Fires once per pick with the picked credId. Host decides single vs multi semantics. */
  onPick: (credId: string) => void
  /** Fires when the connect flow returns a new credential. */
  onConnected?: (credId: string) => void
  /** Fires when the selected connection's "Remove" action is used (unbind only). */
  onRemove?: (credId: string) => void
  /** Trigger placeholder when no value is selected. */
  placeholder?: string
  /** Override the trigger button. Defaults to a compact `PickerTrigger`. */
  triggerClassName?: string
  /** Passed through to the picker. Defaults to true. See `AppAccountPicker`. */
  allowPersonal?: boolean
  /**
   * When true, the popover content matches the trigger button's width instead
   * of the default fixed width. Useful when the trigger is full-width (e.g.
   * inside a form field).
   */
  matchTriggerWidth?: boolean
  /** Override the popover trigger. Defaults to the compact `PickerTrigger`. */
  trigger?: ReactNode
  /**
   * When provided, the picker shows a "View App" row that opens the full
   * `AppSettingsDialog` (hosted by this popover). Omit to hide the row.
   */
  appSettings?: {
    appSlug: string
    installationType: 'development' | 'production'
    returnTo?: string
  }
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
  onRemove,
  placeholder = 'Choose account',
  triggerClassName,
  allowPersonal = true,
  matchTriggerWidth = false,
  trigger,
  appSettings,
}: AppAccountPopoverProps) {
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { appConnections, appInstallations } = useAppsContext()

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
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {trigger ?? (
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
          )}
        </PopoverTrigger>
        <PopoverContentDialogAware
          className={matchTriggerWidth ? 'p-0 w-[var(--radix-popover-trigger-width)]' : 'p-0 w-80'}
          align='start'>
          <AppAccountPicker
            appId={appId}
            value={value}
            onPick={(credId) => {
              onPick(credId)
              setOpen(false)
            }}
            onConnected={onConnected}
            onRemove={
              onRemove
                ? (credId) => {
                    onRemove(credId)
                    setOpen(false)
                  }
                : undefined
            }
            allowPersonal={allowPersonal}
            onViewApp={
              appSettings
                ? () => {
                    setOpen(false)
                    setSettingsOpen(true)
                  }
                : undefined
            }
          />
        </PopoverContentDialogAware>
      </Popover>

      {appSettings && (
        <AppSettingsDialog
          appSlug={appSettings.appSlug}
          installationType={appSettings.installationType}
          returnTo={appSettings.returnTo}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}
    </>
  )
}
