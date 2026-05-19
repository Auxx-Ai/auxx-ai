// apps/web/src/components/apps/ui/app-account-picker.tsx
'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@auxx/ui/components/dialog'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { Check, User as UserIcon, Users } from 'lucide-react'
import { useMemo } from 'react'
import { useUser } from '~/hooks/use-user'
import { type AppConnection, useExtensionsContext } from '~/providers/extensions/extensions-context'
import { api } from '~/trpc/react'
import { useAppCredentialOptions } from '../hooks/use-app-credential-options'
import { useBoundCredential } from '../hooks/use-bound-credential'
import type { ConnectTarget } from '../hooks/use-connect-flow'
import { ConnectButton } from './connect-button'

interface AppAccountPickerProps {
  /** App id (slug) the picker is bound to. `null` keeps the dialog closed. */
  appId: string | null
  agentId: string
  agentSlug: string
  /** Currently-bound credential id, if any. */
  boundCredId: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Cog-triggered dialog that lets the agent's admin pick which credential
 * the agent runs as for one app. Workspace + the current user's personal
 * creds are shown side-by-side; selecting a connected row writes the
 * binding via `agent.update`. "Connect another account" uses
 * `ConnectButton` with popup-mode OAuth — the new credId auto-binds via
 * the `onConnected` callback without the picker reloading.
 *
 * See plans/kopilot/apps/agent-credentials.md §5.4 +
 * plans/kopilot/apps/app-settings-dialog-refactor.md §5.
 */
export function AppAccountPicker({
  appId,
  agentId,
  agentSlug,
  boundCredId,
  open,
  onOpenChange,
}: AppAccountPickerProps) {
  const { appInstallations } = useExtensionsContext()
  const utils = api.useUtils()
  const updateAgent = api.agent.update.useMutation()
  const { isAdminOrOwner } = useUser()

  const installation = useMemo(
    () => (appId ? appInstallations.find((i) => i.app.id === appId) : null),
    [appInstallations, appId]
  )
  const options = useAppCredentialOptions(appId)
  const { user: userDef, organization: orgDef } = installation?.connectionDefinitions ?? {}
  const appName = installation?.app.title ?? ''

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

  const bindCredId = async (credId: string) => {
    if (!appId) return
    const previous = utils.agent.getById.getData({ agentId: agentSlug })
    utils.agent.getById.setData({ agentId: agentSlug }, (old) =>
      old ? { ...old, appAccounts: { ...old.appAccounts, [appId]: { credId } } } : old
    )
    try {
      await updateAgent.mutateAsync({ agentId, appAccounts: { [appId]: { credId } } })
    } catch (err) {
      utils.agent.getById.setData({ agentId: agentSlug }, previous)
      toastError({
        title: 'Failed to set account',
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  const handlePick = async (cred: AppConnection) => {
    await bindCredId(cred.id)
    onOpenChange(false)
  }

  return (
    <Dialog open={open && !!appId} onOpenChange={onOpenChange}>
      <DialogContent size='md' position='tc'>
        <DialogHeader>
          <DialogTitle>Account for {appName}</DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-4'>
          {!installation && <Skeleton className='h-20 w-full' />}
          {installation && options.workspace.length === 0 && options.personal.length === 0 && (
            <p className='text-sm text-muted-foreground'>
              No accounts connected yet. Connect one below.
            </p>
          )}
          {orgDef && options.workspace.length > 0 && (
            <Section title='Workspace'>
              {options.workspace.map((c) => (
                <CredRow
                  key={c.id}
                  cred={c}
                  selected={c.id === boundCredId}
                  onSelect={() => handlePick(c)}
                />
              ))}
            </Section>
          )}
          {userDef && options.personal.length > 0 && (
            <Section title='My accounts'>
              {options.personal.map((c) => (
                <CredRow
                  key={c.id}
                  cred={c}
                  selected={c.id === boundCredId}
                  onSelect={() => handlePick(c)}
                />
              ))}
            </Section>
          )}
          {installation && target && (
            <div className='flex flex-col gap-2 border-t pt-4'>
              <p className='text-xs text-muted-foreground'>Connect another account</p>
              <div className='flex flex-wrap gap-2'>
                {userDef && (
                  <ConnectButton
                    target={target}
                    scope='user'
                    label={
                      <span className='inline-flex items-center gap-1.5'>
                        <UserIcon className='size-3.5' />
                        Connect personal {appName}
                      </span>
                    }
                    onConnected={(credId) => {
                      void bindCredId(credId)
                    }}
                  />
                )}
                {orgDef && (
                  <ConnectButton
                    target={target}
                    scope='organization'
                    disabled={!isAdminOrOwner}
                    disabledReason='Only admins can connect workspace accounts'
                    label={
                      <span className='inline-flex items-center gap-1.5'>
                        <Users className='size-3.5' />
                        Connect workspace {appName}
                      </span>
                    }
                    onConnected={(credId) => {
                      void bindCredId(credId)
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className='flex flex-col gap-1'>
      <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>{title}</p>
      <div className='flex flex-col rounded-md border'>{children}</div>
    </div>
  )
}

function CredRow({
  cred,
  selected,
  onSelect,
}: {
  cred: AppConnection
  selected: boolean
  onSelect: () => void
}) {
  const bound = useBoundCredential(cred.id)
  const statusText =
    bound.status === 'connected'
      ? 'Connected'
      : bound.status === 'expired'
        ? 'Expired'
        : 'Not connected'
  return (
    <button
      type='button'
      onClick={onSelect}
      className={cn(
        'flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-primary-50 border-b last:border-b-0',
        selected && 'bg-primary-50'
      )}>
      <div className='flex flex-col min-w-0'>
        <span className='text-sm truncate'>{cred.label ?? cred.appName}</span>
        {cred.connectedBy && (
          <span className='text-xs text-muted-foreground truncate'>
            Connected by {cred.connectedBy}
          </span>
        )}
      </div>
      <div className='flex items-center gap-2 shrink-0'>
        <span
          className={cn(
            'text-xs',
            bound.status === 'connected'
              ? 'text-green-600'
              : bound.status === 'expired'
                ? 'text-amber-600'
                : 'text-muted-foreground'
          )}>
          {statusText}
        </span>
        {selected && <Check className='size-4 text-foreground' />}
      </div>
    </button>
  )
}
