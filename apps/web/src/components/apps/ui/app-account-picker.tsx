// apps/web/src/components/apps/ui/app-account-picker.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@auxx/ui/components/command'
import { Check, TriangleAlert, User as UserIcon, Users } from 'lucide-react'
import { useMemo } from 'react'
import { useUser } from '~/hooks/use-user'
import { type AppConnection, useExtensionsContext } from '~/providers/extensions/extensions-context'
import { useAppCredentialOptions } from '../hooks/use-app-credential-options'
import { useBoundCredential } from '../hooks/use-bound-credential'
import { type ConnectTarget, useConnectFlow } from '../hooks/use-connect-flow'
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
  /**
   * When false, hides personal credential rows and the "Connect personal
   * account" action. Defaults to true. Master Kopilot passes false because
   * personal creds are user-scoped — pinning master to a personal cred
   * breaks the agent for every other user (see settings README §4.2).
   */
  allowPersonal?: boolean
}

/**
 * Command-based account picker. Renders Personal + Workspace groups of
 * connections plus a footer group with "Connect personal/workspace account"
 * actions. Agnostic of binding semantics — see
 * plans/kopilot/apps/app-account-picker-command-refactor.md §3.
 */
export function AppAccountPicker({
  appId,
  value,
  onPick,
  onConnected,
  allowPersonal = true,
}: AppAccountPickerProps) {
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

  // Reconnect reuses the stored connection (and its variables) server-side, so
  // it only needs the existing credId. Returns undefined when reconnect isn't
  // possible — no target, or a workspace cred the current user can't manage.
  const reconnectHandler = (credId: string, scope: 'user' | 'organization') => {
    if (!target) return undefined
    if (scope === 'organization' && !isAdminOrOwner) return undefined
    return () => flow.start({ target, scope, connectionId: credId })
  }

  return (
    <>
      <Command className='w-full'>
        <CommandList className='max-h-none'>
          {allowPersonal && userDef && options.personal.length > 0 && (
            <CommandGroup heading='Personal'>
              {options.personal.map((c) => (
                <AccountRow
                  key={c.id}
                  cred={c}
                  avatarUrl={avatarUrl}
                  selected={isSelected(c.id)}
                  onSelect={() => onPick(c.id)}
                  onReconnect={reconnectHandler(c.id, 'user')}
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
                  onReconnect={reconnectHandler(c.id, 'organization')}
                />
              ))}
            </CommandGroup>
          )}
          <CommandSeparator />
          <CommandGroup>
            {allowPersonal && userDef && target && (
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
  onReconnect,
}: {
  cred: AppConnection
  avatarUrl: string | null
  selected: boolean
  onSelect: () => void
  /** When set, the row shows a "Reconnect" action for expired/disconnected creds. */
  onReconnect?: () => void
}) {
  const bound = useBoundCredential(cred.id)
  const status: AppConnectionStatus =
    bound.status === 'connected'
      ? 'connected'
      : bound.status === 'expired'
        ? 'expired'
        : 'not_connected'
  const needsReconnect = status !== 'connected'

  return (
    <CommandItem
      value={cred.label ?? cred.appName ?? cred.id}
      onSelect={onSelect}
      className='cursor-pointer h-7.5'>
      <AppWithStatusIcon iconId={avatarUrl ?? 'package'} size='sm' status={status} />
      <span className='truncate'>{cred.label ?? cred.appName}</span>
      {needsReconnect && <TriangleAlert className='size-3.5 shrink-0 text-amber-600' />}
      <div className='ml-auto flex items-center gap-1.5'>
        {selected && (
          <div className='rounded-full size-4 bg-info flex items-center justify-center border border-blue-800'>
            <Check className='size-2.5! text-white' strokeWidth={4} />
          </div>
        )}
        {needsReconnect && onReconnect && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-6 px-2 text-amber-600 hover:text-amber-700'
            onClick={(e) => {
              e.stopPropagation()
              onReconnect()
            }}>
            Reconnect
          </Button>
        )}
      </div>
    </CommandItem>
  )
}
