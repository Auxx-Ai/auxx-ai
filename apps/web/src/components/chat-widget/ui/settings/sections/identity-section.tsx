// apps/web/src/components/chat-widget/ui/settings/sections/identity-section.tsx
'use client'
import type { ChatWidgetWithIntegration } from '@auxx/lib/chat-widget/config'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@auxx/ui/components/input-group'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useCopy } from '@auxx/ui/hooks/use-copy'
import {
  ArrowUpRight,
  Check,
  Copy,
  Globe,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useQueryState } from 'nuqs'
import { useCallback, useState } from 'react'
import { EmailFilterSection } from '~/app/(protected)/app/settings/channels/_components/email-list-dialog'
import { SettingsSection } from '~/components/global/settings-page'
import { Tooltip } from '~/components/global/tooltip'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

interface IdentitySectionProps {
  widget: ChatWidgetWithIntegration
  channelId: string
}

export function IdentitySection({ widget, channelId }: IdentitySectionProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const [, setActiveSection] = useQueryState('s')
  const [, setSetupMode] = useQueryState('mode')
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null)
  const {
    copied: copiedKey,
    copy: copyApiKey,
    reset: resetCopiedKey,
  } = useCopy({
    toastMessage: 'Signing key copied to clipboard',
    autoReset: false,
  })

  const { data: chatKeys = [], refetch } = api.apiKey.getAll.useQuery({ channelId })

  const createKey = api.apiKey.create.useMutation({
    onSuccess: (data) => {
      setNewlyCreatedKey(data.secretKey)
      resetCopiedKey()
      refetch()
    },
    onError: (error) =>
      toastError({ title: 'Failed to create signing key', description: error.message }),
  })

  const deleteKey = api.apiKey.delete.useMutation({
    onSuccess: () => {
      refetch()
      toastSuccess({ description: 'Signing key revoked' })
    },
    onError: (error) =>
      toastError({ title: 'Failed to revoke signing key', description: error.message }),
  })

  const updateChannel = api.channel.updateChatWidgetIntegration.useMutation({
    onSuccess: () => {
      utils.channel.getChatIdentityState.invalidate({ channelId })
      utils.channel.getChatWidgetIntegration.invalidate({ integrationId: channelId })
    },
    onError: (e) => toastError({ title: 'Failed to save', description: e.message }),
  })

  const { data: identityState } = api.channel.getChatIdentityState.useQuery({ channelId })
  const state = identityState?.state ?? 'off'
  const audience = identityState?.audience ?? widget.chatWidget?.chatAudience ?? 'visitors'
  const audienceDisabled = audience === 'visitors'
  const canEnforce = (identityState?.successCount ?? 0) > 0

  const stateLabel = state === 'off' ? 'Off' : state === 'in_progress' ? 'In progress' : 'Enforced'
  const stateBadgeVariant =
    state === 'enforced' ? 'green' : state === 'in_progress' ? 'amber' : 'gray'

  const handleCreate = useCallback(() => {
    createKey.mutate({ type: 'chat', channelId })
  }, [createKey, channelId])

  const handleRevoke = useCallback(
    async (keyId: string) => {
      const confirmed = await confirm({
        title: 'Revoke signing key?',
        description:
          'This permanently disables this key. Any server signing JWTs with it will lose access.',
        confirmText: 'Revoke',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (confirmed) await deleteKey.mutateAsync({ id: keyId })
    },
    [confirm, deleteKey]
  )

  const handleCloseCreatedDialog = useCallback(() => {
    if (copiedKey) {
      setNewlyCreatedKey(null)
      resetCopiedKey()
    }
  }, [copiedKey, resetCopiedKey])

  const handlePreventClose = useCallback(
    (e: Event) => {
      if (!copiedKey) e.preventDefault()
    },
    [copiedKey]
  )

  return (
    <>
      <ConfirmDialog />
      <div className='p-3 sm:p-6 space-y-8'>
        <SettingsSection
          icon={ShieldCheck}
          title='Identity verification'
          description='Sign a short-lived JWT on your server with one of these per-channel secrets so the widget can prove who the visitor is.'>
          <EnforcementCard
            state={state}
            stateLabel={stateLabel}
            stateBadgeVariant={stateBadgeVariant}
            canEnforce={canEnforce}
            hasKeys={chatKeys.length > 0}
            creatingKey={createKey.isPending}
            isPending={updateChannel.isPending}
            disabled={audienceDisabled}
            onOpenGeneral={() => setActiveSection('general')}
            onCreateKey={handleCreate}
            onTransition={(next) =>
              updateChannel.mutate({ integrationId: channelId, identityVerification: next })
            }
            onOpenSetup={() => {
              setSetupMode(null)
              setActiveSection('setup')
            }}
          />

          <div className='relative'>
            <div
              className={
                audienceDisabled ? 'opacity-50 pointer-events-none select-none' : undefined
              }>
              <div className='flex items-center justify-between mb-3'>
                <div>
                  <div className='text-sm font-medium'>Signing keys</div>
                  <p className='text-xs text-muted-foreground'>
                    Multiple active keys are allowed — rotate by creating a new one, switching your
                    server over, then revoking the old.
                  </p>
                </div>
                <Button
                  type='button'
                  size='xs'
                  variant='outline'
                  onClick={handleCreate}
                  loading={createKey.isPending}
                  loadingText='Creating…'>
                  <LockKeyhole className='size-3.5' />
                  Create signing key
                </Button>
              </div>

              {chatKeys.length === 0 ? (
                <p className='text-sm text-muted-foreground'>No signing keys yet.</p>
              ) : (
                <div className='space-y-2'>
                  {chatKeys.map((key) => (
                    <InputGroup key={key.id}>
                      <InputGroupAddon align='inline-start'>
                        <KeyRound className='size-3 text-muted-foreground' />
                      </InputGroupAddon>
                      <InputGroupText className='ms-1 flex-1 truncate font-mono'>
                        {key.name}
                      </InputGroupText>
                      <InputGroupAddon align='inline-end' className='pe-2.5 gap-2'>
                        <Badge variant='gray' className='opacity-50 rounded-lg'>
                          {new Date(key.createdAt).toLocaleDateString()}
                        </Badge>
                        <InputGroupButton
                          type='button'
                          variant='destructive-hover'
                          className='rounded-lg'
                          aria-label='Revoke signing key'
                          title='Revoke'
                          size='icon-xs'
                          onClick={() => handleRevoke(key.id)}
                          disabled={deleteKey.isPending}>
                          <Trash2 />
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                  ))}
                </div>
              )}
            </div>
            {audienceDisabled && (
              <div className='absolute inset-0 flex items-center justify-center pointer-events-none'>
                <button
                  type='button'
                  onClick={() => setActiveSection('general')}
                  className='pointer-events-auto rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-muted'>
                  Change Audience to manage signing keys
                </button>
              </div>
            )}
          </div>
        </SettingsSection>

        <div>
          <EmailFilterSection
            icon={<Globe className='size-4' />}
            title='Allowed Domains'
            description='Restrict where the widget can be embedded. Empty list = allow anywhere.'
            emptyHint='Disabled — widget loads on any site'
            dialogTitle='Allowed Domains'
            dialogDescription='Only these domains will be allowed to embed the widget.'
            dialogPlaceholder='example.com'
            entries={widget.chatWidget?.allowedDomains ?? []}
            onSave={(entries) =>
              updateChannel.mutate({ integrationId: channelId, allowedDomains: entries })
            }
            isPending={updateChannel.isPending}
            activeWarning='Widget will only load on these domains.'
          />
        </div>
      </div>

      <Dialog open={!!newlyCreatedKey} onOpenChange={(open) => !open && handleCloseCreatedDialog()}>
        <DialogContent
          size='sm'
          showClose={false}
          onEscapeKeyDown={handlePreventClose}
          onPointerDownOutside={handlePreventClose}>
          <DialogHeader>
            <DialogTitle>Signing key created</DialogTitle>
            <DialogDescription>
              Copy this signing key now. It won&apos;t be shown again.
            </DialogDescription>
          </DialogHeader>
          <InputGroup>
            <InputGroupAddon align='inline-start'>
              <KeyRound />
            </InputGroupAddon>
            <InputGroupInput
              type='text'
              value={newlyCreatedKey || ''}
              readOnly
              className='font-mono text-xs'
              onFocus={(e) => e.target.select()}
            />
            <InputGroupAddon align='inline-end'>
              <Tooltip content={copiedKey ? 'Copied!' : 'Copy'}>
                <InputGroupButton
                  aria-label='Copy signing key'
                  className='rounded-full'
                  size='icon-xs'
                  onClick={() => newlyCreatedKey && copyApiKey(newlyCreatedKey)}>
                  {copiedKey ? <Check /> : <Copy />}
                </InputGroupButton>
              </Tooltip>
            </InputGroupAddon>
          </InputGroup>
          <DialogFooter>
            <Button
              onClick={handleCloseCreatedDialog}
              size='sm'
              disabled={!copiedKey}
              variant='outline'>
              {copiedKey ? 'Done' : 'Copy to continue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

type EnforcementState = 'off' | 'in_progress' | 'enforced'

interface EnforcementCardProps {
  state: EnforcementState
  stateLabel: string
  stateBadgeVariant: 'gray' | 'amber' | 'green'
  canEnforce: boolean
  hasKeys: boolean
  creatingKey: boolean
  isPending: boolean
  disabled?: boolean
  onTransition: (next: EnforcementState) => void
  onOpenSetup: () => void
  onCreateKey: () => void
  onOpenGeneral?: () => void
}

function EnforcementCard({
  state,
  stateLabel,
  stateBadgeVariant,
  canEnforce,
  hasKeys,
  creatingKey,
  isPending,
  disabled,
  onTransition,
  onOpenSetup,
  onCreateKey,
  onOpenGeneral,
}: EnforcementCardProps) {
  return (
    <div className='relative rounded-2xl border border-border bg-muted/30 p-4 mb-6'>
      <div className={disabled ? 'opacity-50 pointer-events-none select-none' : undefined}>
        <div className='flex items-center gap-2 text-sm font-medium'>
          <LockKeyhole className='size-3.5 text-muted-foreground' />
          Enforcement
          <Badge variant={stateBadgeVariant} className='ml-auto rounded-md'>
            {stateLabel}
          </Badge>
        </div>
        <p className='mt-1 text-xs text-muted-foreground'>
          {state === 'off' &&
            'The widget currently accepts both verified and unverified visitors. Start rollout to begin signing JWTs from your server without breaking existing sessions.'}
          {state === 'in_progress' &&
            'JWT-signed and anonymous traffic both work. Enforce once your server reliably signs every visitor.'}
          {state === 'enforced' &&
            'All chat write requests must carry a valid JWT. Visitors without one are rejected.'}
        </p>

        <div className='mt-4 space-y-2'>
          <div className='flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-xs'>
            <StepBadge done={hasKeys} index={1} />
            <div className='flex-1'>
              <div className='text-sm font-medium text-foreground'>
                {hasKeys ? 'Signing key created' : 'Create a signing key'}
              </div>
              <div className='text-muted-foreground'>
                {hasKeys
                  ? 'Your server can sign JWTs with this per-channel secret.'
                  : 'Create a per-channel secret your server signs JWTs with.'}
              </div>
            </div>
            {!hasKeys && (
              <button
                type='button'
                onClick={onCreateKey}
                disabled={creatingKey}
                className='inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline disabled:opacity-50'>
                {creatingKey ? 'Creating…' : 'Create key'}
              </button>
            )}
          </div>

          <div className='flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-xs'>
            <StepBadge done={canEnforce} index={2} />
            <div className='flex-1'>
              <div className='text-sm font-medium text-foreground'>
                {canEnforce ? 'JWT-signed traffic seen' : 'Wire up your widget with a userJwt'}
              </div>
              <div className='text-muted-foreground'>
                {canEnforce
                  ? 'Your widget is sending signed visitors. Safe to enforce.'
                  : 'Use the Verified setup snippet — server signs a JWT, widget boots with it.'}
              </div>
            </div>
            <button
              type='button'
              onClick={onOpenSetup}
              className='inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline'>
              Open Setup
              <ArrowUpRight className='size-3' />
            </button>
          </div>
        </div>

        <div className='mt-3 flex items-center justify-end'>
          <EnforceActions
            state={state}
            canEnforce={canEnforce}
            hasKeys={hasKeys}
            isPending={isPending}
            onTransition={onTransition}
          />
        </div>
      </div>
      {disabled && (
        <div className='absolute inset-0 flex items-center justify-center pointer-events-none'>
          <button
            type='button'
            onClick={onOpenGeneral}
            className='pointer-events-auto rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-muted'>
            JWT identity is off — change Audience on the General tab
          </button>
        </div>
      )}
    </div>
  )
}

function StepBadge({ done, index }: { done: boolean; index: number }) {
  return (
    <div
      className={
        done
          ? 'flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-400'
          : 'flex size-6 shrink-0 items-center justify-center rounded-full bg-background text-xs font-medium ring-1 ring-border'
      }>
      {done ? <Check className='size-3.5' /> : index}
    </div>
  )
}

function EnforceActions({
  state,
  canEnforce,
  hasKeys,
  isPending,
  onTransition,
}: Pick<EnforcementCardProps, 'state' | 'canEnforce' | 'hasKeys' | 'isPending' | 'onTransition'>) {
  if (state === 'off') {
    if (!hasKeys) {
      return (
        <Tooltip content='Create a signing key first — rollout signs JWTs with it.'>
          <span>
            <Button size='xs' variant='outline' disabled>
              Start rollout
            </Button>
          </span>
        </Tooltip>
      )
    }
    return (
      <Button
        size='xs'
        variant='outline'
        loading={isPending}
        onClick={() => onTransition('in_progress')}>
        Start rollout
      </Button>
    )
  }
  if (state === 'in_progress') {
    return (
      <div className='flex gap-2'>
        <Button size='xs' variant='ghost' loading={isPending} onClick={() => onTransition('off')}>
          Cancel
        </Button>
        {canEnforce ? (
          <Button size='xs' loading={isPending} onClick={() => onTransition('enforced')}>
            Enforce
          </Button>
        ) : (
          <Tooltip content='No valid JWT requests seen yet — install the SDK and pass a userJwt to Auxx.boot before enforcing.'>
            <span>
              <Button size='xs' disabled>
                Enforce
              </Button>
            </span>
          </Tooltip>
        )}
      </div>
    )
  }
  return (
    <Button size='xs' variant='outline' loading={isPending} onClick={() => onTransition('off')}>
      Turn off
    </Button>
  )
}
