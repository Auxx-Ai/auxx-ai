// apps/web/src/components/apps/ui/app-account-picker.tsx
'use client'

import { Command, CommandGroup, CommandItem, CommandList } from '@auxx/ui/components/command'
import { Check, User as UserIcon, Users } from 'lucide-react'
import { useMemo } from 'react'
import { useUser } from '~/hooks/use-user'
import { type AppConnection, useExtensionsContext } from '~/providers/extensions/extensions-context'
import { useAppCredentialOptions } from '../hooks/use-app-credential-options'
import { useBoundCredential } from '../hooks/use-bound-credential'
import { type ConnectTarget, useConnectFlow } from '../hooks/use-connect-flow'
import { AppIcon } from './app-icon'
import { type AppConnectionStatus, AppWithStatusIcon } from './app-with-status-icon'

interface AppAccountPickerProps {
  /** App id (slug) the picker is bound to. */
  appId: string | null
  /** Currently-selected credId(s). String for single-select, array for multi-select. */
  value: string | string[] | undefined
  /** Fires once per pick with the picked credId. Host decides single vs multi semantics. */
  onPick: (credId: string) => void
  /** Fires when the connect flow returns a new credential. */
  onConnected?: (credId: string) => void
}

/**
 * Command-based account picker. Renders Personal + Workspace groups of
 * connections plus a footer group with "Connect personal/workspace account"
 * actions. Agnostic of binding semantics — see
 * plans/kopilot/apps/app-account-picker-command-refactor.md §3.
 */
export function AppAccountPicker({ appId, value, onPick, onConnected }: AppAccountPickerProps) {
  const { appInstallations } = useExtensionsContext()
  const { isAdminOrOwner } = useUser()
  const options = useAppCredentialOptions(appId)

  const installation = useMemo(
    () => (appId ? appInstallations.find((i) => i.app.id === appId) : null),
    [appInstallations, appId]
  )
  const { user: userDef, organization: orgDef } = installation?.connectionDefinitions ?? {}
  const avatarUrl = installation?.app.avatarUrl ?? null

  const target: ConnectTarget | null = useMemo(() => {
    if (!installation || !appId) return null
    return {
      appId,
      appSlug: installation.app.slug,
      appTitle: installation.app.title,
      installationId: installation.installationId,
      connectionDefinitions: installation.connectionDefinitions ?? {},
    }
  }, [installation, appId])

  const flow = useConnectFlow({
    onConnected: (credId) => onConnected?.(credId),
  })

  const isSelected = (credId: string) =>
    Array.isArray(value) ? value.includes(credId) : value === credId

  return (
    <>
      <Command className='w-full'>
        <CommandList className='max-h-none'>
          {userDef && options.personal.length > 0 && (
            <CommandGroup heading='Personal'>
              {options.personal.map((c) => (
                <AccountRow
                  key={c.id}
                  cred={c}
                  avatarUrl={avatarUrl}
                  selected={isSelected(c.id)}
                  onSelect={() => onPick(c.id)}
                />
              ))}
            </CommandGroup>
          )}

          {orgDef && options.workspace.length > 0 && (
            <CommandGroup heading='Workspace'>
              {options.workspace.map((c) => (
                <AccountRow
                  key={c.id}
                  cred={c}
                  avatarUrl={avatarUrl}
                  selected={isSelected(c.id)}
                  onSelect={() => onPick(c.id)}
                />
              ))}
            </CommandGroup>
          )}

          <CommandGroup>
            {userDef && target && (
              <CommandItem
                onSelect={() => flow.start({ target, scope: 'user' })}
                className='cursor-pointer h-7.5'>
                <UserIcon className='text-muted-foreground' />
                <span>Connect personal account</span>
              </CommandItem>
            )}
            {orgDef && target && (
              <CommandItem
                onSelect={() => {
                  if (isAdminOrOwner) flow.start({ target, scope: 'organization' })
                }}
                disabled={!isAdminOrOwner}
                className='cursor-pointer h-7.5'>
                <Users className='text-muted-foreground' />
                <span>Connect workspace account</span>
              </CommandItem>
            )}
          </CommandGroup>
        </CommandList>
      </Command>
      {flow.Dialogs}
    </>
  )
}

function AccountRow({
  cred,
  avatarUrl,
  selected,
  onSelect,
}: {
  cred: AppConnection
  avatarUrl: string | null
  selected: boolean
  onSelect: () => void
}) {
  const bound = useBoundCredential(cred.id)
  const status: AppConnectionStatus =
    bound.status === 'connected'
      ? 'connected'
      : bound.status === 'expired'
        ? 'expired'
        : 'not_connected'

  return (
    <CommandItem
      value={cred.label ?? cred.appName ?? cred.id}
      onSelect={onSelect}
      className='cursor-pointer h-7.5'>
      <AppIcon iconId={avatarUrl ?? 'package'} size='xs' />
      <span className='truncate'>{cred.label ?? cred.appName}</span>
      {selected && (
        <div className='ml-auto rounded-full size-4 bg-info flex items-center justify-center border border-blue-800'>
          <Check className='size-2.5! text-white' strokeWidth={4} />
        </div>
      )}
    </CommandItem>
  )
}
