// apps/web/src/components/channels/ui/channel-gallery-dialog.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { KbdSubmit } from '@auxx/ui/components/kbd'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { toastError } from '@auxx/ui/components/toast'
import { Lock, Users, Waypoints } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useConnectFlow } from '~/components/apps/hooks/use-connect-flow'
import { platformScope, platformTarget } from '~/components/connections/ui/connection-targets'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { useAdminGate } from '~/components/global/admin-gate'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { TemplateGalleryDialog } from '~/components/templates/ui'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import { CHANNEL_CATALOG, CHANNEL_CATEGORIES, type ChannelCatalogItem } from '../catalog'
import { getIntegrationProviderIcon } from './channel-icon'
import ImapConnectForm from './imap-connect-form'
import { InboxDestinationField, useInboxDestination } from './inbox-destination-field'

const RETURN_TO = '/app/settings/channels'
const RESIZE_ID = 'channel-connect'

interface ChannelGalleryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Preselect the delivery inbox (e.g. opened from an inbox's detail page). */
  initialInboxId?: string
}

/**
 * The "Add channel" gallery (replaces the hardcoded `settings/channels/new` pages). Every item
 * opens a detail step that makes inbox selection mandatory before connecting (channels v2):
 * OAuth email (shared/personal + inbox), IMAP (inbox + embedded form), chat, social, and Quo.
 */
export function ChannelGalleryDialog({
  open,
  onOpenChange,
  initialInboxId,
}: ChannelGalleryDialogProps) {
  const router = useRouter()
  const utils = api.useUtils()
  const { isAdminOrOwner } = useAdminGate()

  // Members can only connect personal email accounts — everything else in the
  // catalog is a shared (admin-only) channel.
  const items = useMemo(
    () =>
      isAdminOrOwner
        ? CHANNEL_CATALOG
        : CHANNEL_CATALOG.map((item) =>
            item.kind === 'oauth-email' ? item : { ...item, disabled: true }
          ),
    [isAdminOrOwner]
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId]
  )

  // Shared detail state, reset on detail exit. Non-admins start on (and are
  // effectively limited to) the personal scope.
  const defaultScope: 'shared' | 'personal' = isAdminOrOwner ? 'shared' : 'personal'
  const inbox = useInboxDestination(initialInboxId)
  const [scope, setScope] = useState<'shared' | 'personal'>(defaultScope)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [chatName, setChatName] = useState('')
  const [redirecting, setRedirecting] = useState(false)

  const isOAuth = selected?.kind === 'oauth-email' || selected?.kind === 'social'
  const personalEligible = selected?.kind === 'oauth-email'
  const isPersonal = personalEligible && scope === 'personal'

  const prep = api.channel.prepareConnect.useQuery(
    { provider: selected?.provider ?? 'google', personal: isPersonal },
    { enabled: open && isOAuth && !!selected?.provider, retry: false }
  )

  // Quo (secret connection) rides the shared connect flow, carrying `{ inboxId }` as post-connect.
  const { data: providers = [] } = api.connections.listProviders.useQuery(undefined, {
    enabled: open,
  })
  const flow = useConnectFlow({
    showName: true,
    onConnected: () => {
      utils.channel.list.invalidate()
      onOpenChange(false)
    },
  })

  const createChatChannel = api.channel.createChatChannel.useMutation()

  const detailBusy = redirecting || createChatChannel.isPending || inbox.creating || flow.pending

  function resetDetail() {
    inbox.reset()
    setScope(defaultScope)
    setClientId('')
    setClientSecret('')
    setChatName('')
    setRedirecting(false)
  }

  const needsOwnClient = !!prep.data?.requiresOwnClient
  const ownClientReady = !needsOwnClient || (!!clientId.trim() && !!clientSecret.trim())

  // ── Connect actions ────────────────────────────────────────────────────────

  async function connectOAuth() {
    if (!prep.data) return
    try {
      setRedirecting(true)
      const url = new URL(prep.data.authorizeUrl, window.location.origin)
      url.searchParams.set('returnTo', RETURN_TO)
      if (isPersonal) {
        url.searchParams.set('personal', '1')
      } else {
        url.searchParams.set('pc_inboxId', await inbox.resolve())
      }
      if (prep.data.requiresOwnClient) {
        url.searchParams.set('var_clientId', clientId.trim())
        url.searchParams.set('var_clientSecret', clientSecret.trim())
      }
      window.location.href = url.toString()
    } catch (error) {
      setRedirecting(false)
      toastError({
        title: 'Could not start connect',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  async function connectChat() {
    try {
      const inboxId = await inbox.resolve()
      const { channelId } = await createChatChannel.mutateAsync({
        inboxId,
        name: chatName.trim() || undefined,
      })
      utils.channel.list.invalidate()
      onOpenChange(false)
      router.push(`${RETURN_TO}/${channelId}`)
    } catch (error) {
      toastError({
        title: 'Failed to create chat widget',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  async function connectPhone(item: ChannelCatalogItem) {
    const provider = providers.find((p) => p.providerKey === item.providerKey)
    if (!provider) return
    try {
      const inboxId = await inbox.resolve()
      flow.start({
        target: platformTarget(provider),
        scope: platformScope(provider),
        postConnect: { inboxId },
      })
    } catch (error) {
      toastError({
        title: 'Could not start connect',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  // ── Detail steps ────────────────────────────────────────────────────────────

  /** BYO OAuth-client rows (client id/secret) shown when the platform client is unusable. */
  function renderOwnClientFields() {
    if (!prep.data?.requiresOwnClient) return null
    return (
      <>
        <p className='text-xs text-muted-foreground'>
          {prep.data.ownClientReason === 'pending-approval'
            ? 'Our platform app is pending verification — connect with your own OAuth client for now.'
            : 'No platform app is configured — enter your own OAuth client credentials.'}
        </p>
        <FieldPanel orientation='responsive' resizeId={RESIZE_ID} className='p-0'>
          <FieldPanelRow title='Client ID' type={BaseType.STRING} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={clientId}
              onChange={(v) => setClientId((v as string) ?? '')}
              placeholder='Your OAuth client id'
              disabled={redirecting}
            />
          </FieldPanelRow>
          <FieldPanelRow title='Client Secret' type={BaseType.STRING} showIcon isRequired>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              fieldOptions={{ secret: true }}
              value={clientSecret}
              onChange={(v) => setClientSecret((v as string) ?? '')}
              placeholder='Your OAuth client secret'
              disabled={redirecting}
            />
          </FieldPanelRow>
        </FieldPanel>
      </>
    )
  }

  function renderOAuthDetail(item: ChannelCatalogItem) {
    const loading = prep.isLoading && !prep.data && !prep.error
    // A non-admin's shared query is rejected — steer to Personal (open to every member).
    const prepError = prep.error as { data?: { code?: string }; message?: string } | null
    const sharedForbidden =
      !!prepError && !isPersonal && prepError.data?.code === 'FORBIDDEN' && personalEligible

    return (
      <div className='flex flex-col gap-3 p-3'>
        {loading ? (
          <p className='text-sm text-muted-foreground'>Loading…</p>
        ) : (
          <>
            {personalEligible && (
              <RadioGroup
                value={scope}
                onValueChange={(v) => setScope(v as 'shared' | 'personal')}
                className='grid gap-2 sm:grid-cols-2'>
                <RadioGroupItemCard
                  value='shared'
                  label='Shared inbox'
                  icon={<Users />}
                  description='For the whole team — mail lands in a shared inbox'
                />
                <RadioGroupItemCard
                  value='personal'
                  label='Personal account'
                  icon={<Lock />}
                  description='Private to you — admins see activity only'
                />
              </RadioGroup>
            )}

            {prepError && (
              <p className='text-sm text-muted-foreground'>
                {sharedForbidden
                  ? 'Only admins can connect shared channels. Choose "Personal account" to connect your own mailbox.'
                  : prepError.message}
              </p>
            )}

            {isPersonal ? (
              <p className='text-sm text-muted-foreground'>
                A private inbox named after the address is created for you — teammates only see what
                you assign or share.
              </p>
            ) : (
              <FieldPanel orientation='responsive' resizeId={RESIZE_ID} className='p-0'>
                <InboxDestinationField controller={inbox} disabled={redirecting} />
              </FieldPanel>
            )}

            {renderOwnClientFields()}
          </>
        )}
      </div>
    )
  }

  function renderChatDetail() {
    return (
      <div className='flex flex-col gap-3 p-3'>
        <FieldPanel orientation='responsive' resizeId={RESIZE_ID} className='p-0'>
          <FieldPanelRow title='Widget name' type={BaseType.STRING} showIcon>
            <FieldInputAdapter
              fieldType={FieldType.TEXT}
              value={chatName}
              onChange={(v) => setChatName((v as string) ?? '')}
              placeholder='Chat Widget'
            />
          </FieldPanelRow>
          <InboxDestinationField controller={inbox} />
        </FieldPanel>
      </div>
    )
  }

  function renderPhoneDetail() {
    return (
      <div className='flex flex-col gap-3 p-3'>
        <FieldPanel orientation='responsive' resizeId={RESIZE_ID} className='p-0'>
          <InboxDestinationField controller={inbox} />
        </FieldPanel>
        <p className='text-xs text-muted-foreground'>
          You'll enter your Quo API key and phone number in the next step.
        </p>
      </div>
    )
  }

  function renderImapDetail(helpers: { close: () => void }) {
    return (
      <div className='flex flex-col gap-4 p-3'>
        <FieldPanel orientation='responsive' resizeId={RESIZE_ID} className='p-0'>
          <InboxDestinationField controller={inbox} />
        </FieldPanel>
        <ImapConnectForm
          inbox={inbox}
          onSuccess={() => {
            utils.channel.list.invalidate()
            helpers.close()
          }}
        />
      </div>
    )
  }

  // ── Footer (Connect) ────────────────────────────────────────────────────────

  function connectDisabled(item: ChannelCatalogItem): boolean {
    switch (item.kind) {
      case 'oauth-email':
        return isPersonal ? !prep.data : !inbox.isValid || !ownClientReady || !prep.data
      case 'social':
        return !inbox.isValid || !ownClientReady || !prep.data
      case 'chat':
      case 'phone':
        return !inbox.isValid
      default:
        return true
    }
  }

  function handleConnect(item: ChannelCatalogItem) {
    switch (item.kind) {
      case 'oauth-email':
      case 'social':
        void connectOAuth()
        break
      case 'chat':
        void connectChat()
        break
      case 'phone':
        void connectPhone(item)
        break
    }
  }

  return (
    <>
      <TemplateGalleryDialog<ChannelCatalogItem>
        open={open}
        onOpenChange={onOpenChange}
        title='Add a channel'
        description='Connect email, chat, social, and phone channels'
        crumbLabel='Channels'
        crumbIcon={<Waypoints />}
        itemNoun='channel'
        items={items}
        categories={CHANNEL_CATEGORIES}
        selectedId={selectedId}
        onSelectedIdChange={setSelectedId}
        detailSize='lg'
        onDetailExit={resetDetail}
        detailBusy={detailBusy}
        renderIcon={(item) => (
          <div className='flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background'>
            {getIntegrationProviderIcon(item.id, 'size-4')}
          </div>
        )}
        renderBadges={(item) =>
          item.kind === 'coming-soon' ? (
            <Badge variant='secondary' className='text-xs'>
              Coming soon
            </Badge>
          ) : (
            item.categories.map((cat) => (
              <Badge key={cat} variant='outline' className='text-xs'>
                {CHANNEL_CATEGORIES.find((c) => c.value === cat)?.label ?? cat}
              </Badge>
            ))
          )
        }
        onSelectItem={(item) => (item.disabled ? 'handled' : undefined)}
        detailCrumb={(item) => `Connect ${item.name}`}
        renderDetail={(item, helpers) => {
          switch (item.kind) {
            case 'oauth-email':
            case 'social':
              return renderOAuthDetail(item)
            case 'chat':
              return renderChatDetail()
            case 'phone':
              return renderPhoneDetail()
            case 'imap':
              return renderImapDetail(helpers)
            default:
              return null
          }
        }}
        renderDetailFooter={(item) => {
          // IMAP owns its own Connect button (inside the embedded form).
          if (item.kind === 'imap' || item.kind === 'coming-soon') return null
          return (
            <Button
              size='sm'
              variant='outline'
              onClick={() => handleConnect(item)}
              disabled={connectDisabled(item) || detailBusy}
              loading={detailBusy}
              loadingText='Connecting…'
              data-dialog-submit>
              Connect <KbdSubmit variant='outline' size='sm' />
            </Button>
          )
        }}
      />
      {flow.Dialogs}
    </>
  )
}
