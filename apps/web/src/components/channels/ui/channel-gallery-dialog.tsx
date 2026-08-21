// apps/web/src/components/channels/ui/channel-gallery-dialog.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { KbdSubmit } from '@auxx/ui/components/kbd'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { toastError } from '@auxx/ui/components/toast'
import { ChevronDown, ChevronRight, Lock, Users, Waypoints } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type ConnectFlowArgs,
  type ConnectFlowDefinition,
  useConnectFlow,
} from '~/components/apps/hooks/use-connect-flow'
import { OwnClientCallbackNotice } from '~/components/connections/ui/own-client-callback-notice'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { TemplateGalleryDialog } from '~/components/templates/ui'
import { BaseType } from '~/components/workflow/types'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { CHANNEL_CATALOG, CHANNEL_CATEGORIES, type ChannelCatalogItem } from '../catalog'
import { getIntegrationProviderIcon } from './channel-icon'
import { useConnectSelection } from './connect-selection-page'
import ImapConnectForm from './imap-connect-form'
import { InboxDestinationField, useInboxDestination } from './inbox-destination-field'
import QuoConnectForm from './quo-connect-form'

const DEFAULT_RETURN_TO = '/app/settings/channels'
const RESIZE_ID = 'channel-connect'

interface ChannelGalleryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Preselect the delivery inbox (e.g. opened from an inbox's detail page). */
  initialInboxId?: string
  /** Restrict the gallery to personal Gmail/Outlook connections. */
  personalOnly?: boolean
  /** OAuth return destination. */
  returnTo?: string
  /**
   * Also resume a two-phase connect parked before this dialog opened — a reload mid-pick, a popup
   * that was blocked into a full-page redirect, a closed tab. The dialog opens itself onto the
   * selection step when it finds one.
   *
   * Opt-in per host, because self-opening is only correct where the parked connect could have
   * landed: the channels settings page (the OAuth `returnTo`) and an inbox's detail page. The
   * personal-inbox gallery never sets it — a personal connect parks nothing, and its members
   * can't read the query anyway.
   */
  resumePendingConnect?: boolean
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
  personalOnly = false,
  returnTo = DEFAULT_RETURN_TO,
  resumePendingConnect = false,
}: ChannelGalleryDialogProps) {
  const router = useRouter()
  const utils = api.useUtils()
  // `channel.prepareConnect` requires `channels.manage` for a SHARED connect and
  // is open to every member for a personal one, so gate the catalog on that same
  // capability rather than the legacy ADMIN/OWNER role.
  const { can } = useAccess()
  const canConnectShared = can(PermissionKey.channelsManage)

  // Members can only connect personal email accounts — everything else in the
  // catalog is a shared (admin-only) channel.
  const items = useMemo(
    () =>
      personalOnly
        ? CHANNEL_CATALOG.filter((item) => item.kind === 'oauth-email')
        : canConnectShared
          ? CHANNEL_CATALOG
          : CHANNEL_CATALOG.map((item) =>
              item.kind === 'oauth-email' ? item : { ...item, disabled: true }
            ),
    [canConnectShared, personalOnly]
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId]
  )

  // Shared detail state, reset on detail exit. Non-admins start on (and are
  // effectively limited to) the personal scope.
  const defaultScope: 'shared' | 'personal' =
    personalOnly || !canConnectShared ? 'personal' : 'shared'
  const inbox = useInboxDestination(initialInboxId, { enabled: !personalOnly })
  const [scope, setScope] = useState<'shared' | 'personal'>(defaultScope)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  // Opt-in to BYO client from the optional "advanced" section (pending-approval case).
  const [useOwnClient, setUseOwnClient] = useState(false)
  const [chatName, setChatName] = useState('')

  const isOAuth = selected?.kind === 'oauth-email' || selected?.kind === 'social'
  const personalEligible = selected?.kind === 'oauth-email'
  const isPersonal = personalEligible && scope === 'personal'

  const prep = api.channel.prepareConnect.useQuery(
    { provider: selected?.provider ?? 'google', personal: isPersonal },
    { enabled: open && isOAuth && !!selected?.provider, retry: false }
  )

  // Platform provider catalog — Quo's row (`openphone`) feeds its dedicated connect form.
  const { data: providers = [] } = api.connections.listProviders.useQuery(undefined, {
    enabled: open && !personalOnly,
  })
  /** A channel now exists — refresh every list that shows one, and get out of the way. */
  function finishConnect() {
    void utils.channel.list.invalidate()
    void utils.inbox.settingsList.invalidate()
    void utils.record.listAll.invalidate()
    onOpenChange(false)
  }

  /**
   * Whether the selection step owns the dialog body, readable from `flow`'s callbacks — which are
   * declared before it. A ref rather than an ordering shuffle because the two genuinely refer to
   * each other: the flow suppresses its settle while the step is up, and the step releases the
   * flow when the server answers.
   */
  const selectionActive = useRef(false)

  const flow = useConnectFlow({
    showName: true,
    // Suppressed while the selection step owns the body: the popup settled on a credential, but
    // a two-phase connect has no channel yet, and closing here would take the picker with it.
    onConnected: () => {
      if (selectionActive.current) return
      finishConnect()
    },
    // The popup's `awaiting` hint. Purely a latency shortcut now — the step is already on screen
    // and its own signals fill it in — so all this does is skip one poll interval.
    onAwaiting: () => void utils.channel.pendingConnectSelection.invalidate(),
  })

  /**
   * The selection step, for connects the OAuth callback cannot finish on its own (which Facebook
   * Page becomes the channel).
   *
   * Nothing here waits for a signal to decide whether to show it: `connectOAuth` calls `begin()`
   * on click, and the step fills itself in from `connection:settled` / its own poll. See
   * `connect-selection-page.tsx` for why that inversion is the whole fix.
   */
  const selection = useConnectSelection({
    enabled: !personalOnly && canConnectShared,
    resume: resumePendingConnect,
    // Whatever the popup is still doing, the server has answered — release the busy state so a
    // popup that can no longer be observed (COOP, a closed tab) doesn't hold the UI to its
    // 180s ceiling.
    onSettled: () => flow.cancel(),
    onFinished: finishConnect,
  })
  // `extraPage` is a fresh object every render, so gate on the boolean — otherwise every effect
  // and ref keyed on it churns once per render for the whole life of the step.
  const onSelectionStep = !!selection.extraPage
  selectionActive.current = onSelectionStep

  // Resume: a parked connect found on mount opens the dialog onto its step.
  useEffect(() => {
    if (onSelectionStep && !open) onOpenChange(true)
  }, [onSelectionStep, open, onOpenChange])

  const createChatChannel = api.channel.createChatChannel.useMutation()

  // Not applied on the selection step: the popup flow can still read as pending there (an
  // unobservable popup holds `pending` until its ceiling), and Cancel is the only way out of it.
  const detailBusy =
    !onSelectionStep && (createChatChannel.isPending || inbox.creating || flow.pending)

  function resetDetail() {
    inbox.reset()
    setScope(defaultScope)
    setClientId('')
    setClientSecret('')
    setUseOwnClient(false)
    setChatName('')
  }

  // `requiresOwnClient` → BYO mandatory (no platform client). `ownClientOptional` →
  // platform login works and BYO is offered as an alternative the user can opt into via
  // the advanced section, either because the app is pending provider verification
  // (`pending-approval`) or because the org holds `byoOAuthClient` (`byo-entitled`).
  const needsOwnClient = !!prep.data?.requiresOwnClient
  const ownClientOptional = !!prep.data?.ownClientOptional
  const ownClientReason = prep.data?.ownClientReason ?? null
  const oauthCallbackUrl = prep.data?.oauthCallbackUrl ?? null
  // BYO fields are active (must be filled to connect) when mandatory, or opted-in.
  const byoActive = needsOwnClient || (ownClientOptional && useOwnClient)
  const ownClientReady = !byoActive || (!!clientId.trim() && !!clientSecret.trim())

  // ── Connect actions ────────────────────────────────────────────────────────

  /** Build the connect-flow target for an OAuth email/social provider from `channel.prepareConnect`. */
  function oauthTarget(
    data: NonNullable<typeof prep.data>,
    item: ChannelCatalogItem
  ): ConnectFlowArgs['target'] {
    const def: ConnectFlowDefinition = { connectionType: 'oauth2-code' }
    return {
      owner: {
        kind: 'platform',
        connectionDefinitionId: data.connectionDefinitionId,
        providerKey: data.providerKey,
      },
      title: item.name,
      connectionDefinitions: isPersonal ? { user: def } : { organization: def },
    }
  }

  async function connectOAuth(item: ChannelCatalogItem) {
    if (!prep.data) return
    try {
      const postConnect = isPersonal ? undefined : { inboxId: await inbox.resolve() }
      // A social connect always stops short of provisioning to ask which Page (even for a grant
      // that reached exactly one — see `connect-selection-page.tsx`), so move to that step NOW,
      // with the popup opening on top of it. Nothing later has to decide to open it.
      if (item.kind === 'social') selection.begin()
      // BYO-client id/secret are collected inline (renderOwnClientFields) — `connectWith` skips
      // the hook's own variable dialog and submits these values straight into the OAuth kickoff.
      flow.connectWith(
        {
          target: oauthTarget(prep.data, item),
          scope: isPersonal ? 'user' : 'organization',
          personal: isPersonal,
          postConnect,
          returnTo,
        },
        {
          // Submit BYO client id/secret only when the user is actually using their own
          // client (mandatory, or opted in via the advanced section). Otherwise start the
          // platform-client flow (which, while pending verification, shows Google's
          // "unverified app" warning and is limited to test users for restricted scopes).
          values: byoActive
            ? { clientId: clientId.trim(), clientSecret: clientSecret.trim() }
            : undefined,
        }
      )
    } catch (error) {
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
      router.push(`${returnTo}/${channelId}`)
    } catch (error) {
      toastError({
        title: 'Failed to create chat widget',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  // ── Detail steps ────────────────────────────────────────────────────────────

  /** The client id/secret input rows — shared by the mandatory and optional BYO paths. */
  function renderClientCredFields() {
    return (
      <FieldPanel orientation='responsive' resizeId={RESIZE_ID} className='p-0'>
        <FieldPanelRow title='Client ID' type={BaseType.STRING} showIcon isRequired>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            value={clientId}
            onChange={(v) => setClientId((v as string) ?? '')}
            placeholder='Your OAuth client id'
            disabled={flow.pending}
          />
        </FieldPanelRow>
        <FieldPanelRow title='Client Secret' type={BaseType.STRING} showIcon isRequired>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            fieldOptions={{ secret: true }}
            value={clientSecret}
            onChange={(v) => setClientSecret((v as string) ?? '')}
            placeholder='Your OAuth client secret'
            disabled={flow.pending}
          />
        </FieldPanelRow>
      </FieldPanel>
    )
  }

  /**
   * BYO OAuth-client section. Mandatory (`requiresOwnClient`, no platform client) renders the
   * fields inline. Optional (`ownClientOptional`, platform app pending Google verification)
   * keeps the platform login primary and tucks the fields behind an advanced disclosure.
   */
  function renderOwnClientFields() {
    if (needsOwnClient) {
      return (
        <>
          <p className='text-xs text-muted-foreground'>
            No platform app is configured — enter your own OAuth client credentials.
          </p>
          <OwnClientCallbackNotice callbackUrl={oauthCallbackUrl} />
          {renderClientCredFields()}
        </>
      )
    }
    if (ownClientOptional) {
      return (
        <div className='flex flex-col gap-2'>
          <p className='text-xs text-muted-foreground'>
            {ownClientReason === 'pending-approval'
              ? `This app's platform OAuth client is pending provider verification — during sign-in you may see an "unverified app" warning (and access can be limited to test accounts). You can continue with it, or use your own OAuth client below.`
              : 'Connect with our platform OAuth app, or use your own OAuth client below.'}
          </p>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-auto w-fit gap-1 px-1 py-0.5 text-xs text-muted-foreground'
            onClick={() => setUseOwnClient((v) => !v)}>
            {useOwnClient ? <ChevronDown /> : <ChevronRight />}
            Use your own OAuth client (advanced)
          </Button>
          {useOwnClient && (
            <>
              <OwnClientCallbackNotice callbackUrl={oauthCallbackUrl} />
              {renderClientCredFields()}
            </>
          )}
        </div>
      )
    }
    return null
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
            {personalEligible && !personalOnly && (
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
                <InboxDestinationField controller={inbox} disabled={flow.pending} />
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

  /**
   * Quo: an API key covers a whole workspace, so the number is a picker rather than a typed
   * field — which the generic connect form (static `ConnectionVariable.options`) can't express.
   * The dedicated form owns its own Connect button, like IMAP.
   */
  function renderPhoneDetail(item: ChannelCatalogItem, helpers: { close: () => void }) {
    const provider = providers.find((p) => p.providerKey === item.providerKey)
    return (
      <div className='flex flex-col gap-4 p-3'>
        <FieldPanel orientation='responsive' resizeId={RESIZE_ID} className='p-0'>
          <InboxDestinationField controller={inbox} />
        </FieldPanel>
        {provider ? (
          <QuoConnectForm
            provider={provider}
            inbox={inbox}
            onSuccess={() => {
              void utils.channel.list.invalidate()
              void utils.inbox.settingsList.invalidate()
              void utils.record.listAll.invalidate()
              helpers.close()
            }}
          />
        ) : (
          <p className='text-sm text-muted-foreground'>Loading…</p>
        )}
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
        return !inbox.isValid
      // 'phone' owns its own Connect button (QuoConnectForm) — no shell footer.
      default:
        return true
    }
  }

  function handleConnect(item: ChannelCatalogItem) {
    switch (item.kind) {
      case 'oauth-email':
      case 'social':
        void connectOAuth(item)
        break
      case 'chat':
        void connectChat()
        break
    }
  }

  return (
    <>
      <TemplateGalleryDialog<ChannelCatalogItem>
        open={open}
        onOpenChange={(next) => {
          // The shell's Cancel is a host-level close, so dismissing the selection step arrives
          // here. Tell it, or the resume path re-opens what the user just closed.
          if (!next && onSelectionStep) selection.dismiss()
          onOpenChange(next)
        }}
        title={personalOnly ? 'Connect personal account' : 'Add a channel'}
        description={
          personalOnly
            ? 'Connect Gmail or Outlook to create your private inbox'
            : 'Connect email, chat, social, and phone channels'
        }
        crumbLabel={personalOnly ? 'Personal inboxes' : 'Channels'}
        crumbIcon={<Waypoints />}
        itemNoun='channel'
        items={items}
        categories={CHANNEL_CATEGORIES}
        selectedId={selectedId}
        onSelectedIdChange={setSelectedId}
        detailSize='lg'
        extraPage={selection.extraPage}
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
              return renderPhoneDetail(item, helpers)
            case 'imap':
              return renderImapDetail(helpers)
            default:
              return null
          }
        }}
        renderDetailFooter={(item) => {
          // IMAP and Quo own their Connect button (inside their embedded form).
          if (item.kind === 'imap' || item.kind === 'phone' || item.kind === 'coming-soon')
            return null
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
