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
  Check,
  Copy,
  Globe,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Terminal,
  Trash2,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { EmailFilterSection } from '~/app/(protected)/app/settings/channels/_components/email-list-dialog'
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
      utils.channel.getChatWidgetIntegration.invalidate({ integrationId: channelId })
    },
    onError: (e) => toastError({ title: 'Failed to save', description: e.message }),
  })

  const { data: identityState } = api.channel.getChatIdentityState.useQuery({ channelId })
  const setIdentity = api.channel.setChatIdentityVerificationState.useMutation({
    onSuccess: () => {
      utils.channel.getChatIdentityState.invalidate({ channelId })
      utils.channel.getChatWidgetIntegration.invalidate({ integrationId: channelId })
    },
    onError: (e) =>
      toastError({ title: 'Failed to update enforcement state', description: e.message }),
  })
  const state = identityState?.state ?? 'off'
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
      <div className='flex flex-col lg:flex-row'>
        <div className='flex-1 p-6 lg:pr-6'>
          <div className='space-y-1 mb-4'>
            <div className='flex items-center gap-2 text-base font-semibold tracking-tight text-foreground'>
              <ShieldCheck className='size-4' /> Identity verification
            </div>
            <p className='text-sm text-muted-foreground'>
              Sign a short-lived JWT on your server with one of these per-channel secrets so the
              widget can prove who the visitor is. Phase 3 wires verification end-to-end; for now,
              you can mint and rotate keys here.
            </p>
          </div>

          <EnforcementCard
            state={state}
            stateLabel={stateLabel}
            stateBadgeVariant={stateBadgeVariant}
            canEnforce={canEnforce}
            isPending={setIdentity.isPending}
            onTransition={(next) => setIdentity.mutate({ channelId, state: next })}
          />

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

        <div className='flex-1 border-t lg:border-t-0 lg:border-l p-6 lg:pl-6'>
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
  isPending: boolean
  onTransition: (next: EnforcementState) => void
}

function EnforcementCard({
  state,
  stateLabel,
  stateBadgeVariant,
  canEnforce,
  isPending,
  onTransition,
}: EnforcementCardProps) {
  return (
    <div className='rounded-md border border-border bg-muted/30 p-4 mb-6'>
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

      <ol className='mt-4 space-y-3'>
        <Step
          n={1}
          title='Install @auxx/chat'
          snippet={'npm install @auxx/chat'}
          done={state !== 'off'}
        />
        <Step
          n={2}
          title='Sign JWTs on your server'
          snippet={SIGN_SNIPPET}
          done={state !== 'off'}
        />
        <Step
          n={3}
          title='Pass the JWT to the widget'
          snippet={BOOT_SNIPPET}
          done={state !== 'off'}
        />
        <li className='flex items-center gap-3'>
          <div className='flex size-6 shrink-0 items-center justify-center rounded-full bg-background text-xs font-medium ring-1 ring-border'>
            4
          </div>
          <div className='flex-1 text-sm'>Enforce</div>
          <EnforceActions
            state={state}
            canEnforce={canEnforce}
            isPending={isPending}
            onTransition={onTransition}
          />
        </li>
      </ol>
    </div>
  )
}

function EnforceActions({
  state,
  canEnforce,
  isPending,
  onTransition,
}: Pick<EnforcementCardProps, 'state' | 'canEnforce' | 'isPending' | 'onTransition'>) {
  if (state === 'off') {
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

function Step({
  n,
  title,
  snippet,
  done,
}: {
  n: number
  title: string
  snippet: string
  done: boolean
}) {
  const { copied, copy } = useCopy({ toastMessage: 'Snippet copied', autoReset: true })
  return (
    <li className='flex gap-3'>
      <div
        className={
          done
            ? 'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-400'
            : 'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-background text-xs font-medium ring-1 ring-border'
        }>
        {done ? <Check className='size-3.5' /> : n}
      </div>
      <div className='flex-1 min-w-0'>
        <div className='text-sm'>{title}</div>
        <div className='mt-1 relative group'>
          <pre className='overflow-x-auto rounded-md bg-background p-2 text-xs font-mono ring-1 ring-border'>
            <Terminal className='inline-block size-3 text-muted-foreground mr-1 align-[-1px]' />
            {snippet}
          </pre>
          <button
            type='button'
            aria-label='Copy snippet'
            className='absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-muted'
            onClick={() => copy(snippet)}>
            {copied ? <Check className='size-3' /> : <Copy className='size-3' />}
          </button>
        </div>
      </div>
    </li>
  )
}

const SIGN_SNIPPET = `import { signUserJwt } from '@auxx/chat/server'

const token = await signUserJwt(
  { user_id: user.id, email: user.email },
  process.env.AUXX_CHAT_SECRET!
)`

const BOOT_SNIPPET = `import Auxx from '@auxx/chat'

Auxx.boot({
  channelId: '<your channel id>',
  userJwt: token,
})`
