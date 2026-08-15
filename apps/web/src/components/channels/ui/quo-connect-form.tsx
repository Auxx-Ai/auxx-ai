// apps/web/src/components/channels/ui/quo-connect-form.tsx
'use client'

import { FieldType } from '@auxx/database/enums'
import type { SelectOption } from '@auxx/types/custom-field'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { RadioGroup } from '@auxx/ui/components/radio-group'
import { RadioGroupItemCard } from '@auxx/ui/components/radio-group-item'
import { toastError } from '@auxx/ui/components/toast'
import { Phone, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ProviderRow } from '~/components/connections/ui/connection-targets'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { FieldPanel, FieldPanelRow } from '~/components/global/forms/field-panel'
import { BaseType } from '~/components/workflow/types'
import { api } from '~/trpc/react'
import type { InboxDestinationController } from './inbox-destination-field'

/** Shared with the gallery so both panels drag their label column together. */
const RESIZE_ID = 'channel-connect'

/** Full-width control flush to the row label (matches InboxDestinationField). */
const FIELD_TRIGGER_PROPS = { className: 'w-full ps-0 pe-1' }

/** A number on a Quo workspace (`channel.quoPhoneNumbers` / `channel.quoCachedNumbers`). */
interface QuoPhoneNumber {
  id: string
  number: string
  name: string | null
  usRestricted: boolean
}

interface QuoConnectFormProps {
  /** The `openphone` platform provider row from `connections.listProviders`. */
  provider: ProviderRow
  /** Inbox-destination controller from the detail step — resolved on Connect. */
  inbox: InboxDestinationController
  /** Fired after a successful connect (gallery invalidates + closes). */
  onSuccess: () => void
}

/**
 * The number picker, shared by both connect paths.
 *
 * Identical markup whether the list came from a pasted key (live fetch) or from
 * `Credential.metadata.quo` (cached) — the two paths differ only in where the numbers come
 * from, so the restriction warnings live here rather than being written twice.
 *
 * Two different "can't use this" states, deliberately treated differently:
 *  - **US-restricted** stays SELECTABLE. Such a number still receives messages and still sends
 *    outside the US; only outbound US SMS fails. Blocking it would be wrong for inbound-only or
 *    non-US use, so it is flagged, not disabled.
 *  - **Already connected** is DISABLED. One phone number backs at most one live Integration —
 *    picking it again would relink the existing channel rather than create a second one.
 */
function QuoNumberPicker({
  numbers,
  value,
  onChange,
  usedIds,
  disabled,
}: {
  numbers: QuoPhoneNumber[]
  value: string
  onChange: (phoneNumberId: string) => void
  /** `phoneNumberId`s that already back a live channel. */
  usedIds: ReadonlySet<string>
  disabled?: boolean
}) {
  const restricted = numbers.filter((n) => n.usRestricted)
  const selected = numbers.find((n) => n.id === value) ?? null
  const allUsed = numbers.every((n) => usedIds.has(n.id))

  return (
    <>
      <div className='flex flex-col gap-2'>
        <p className='text-xs text-muted-foreground'>
          Choose the number this channel sends and receives from.
        </p>
        <RadioGroup value={value} onValueChange={onChange} className='grid gap-2'>
          {numbers.map((number) => {
            const used = usedIds.has(number.id)
            return (
              <RadioGroupItemCard
                key={number.id}
                value={number.id}
                icon={<Phone />}
                label={number.number}
                sublabel={
                  used ? 'Already connected' : number.usRestricted ? 'US SMS restricted' : undefined
                }
                description={number.name ?? undefined}
                disabled={used || disabled}
                className={used ? 'opacity-60' : undefined}
              />
            )
          })}
        </RadioGroup>
        {allUsed && (
          // Otherwise every card is disabled and Connect never enables, with nothing saying why.
          <p className='text-xs text-muted-foreground'>
            Every number on this workspace already has a channel. Add a number in Quo to connect
            another.
          </p>
        )}
      </div>

      {restricted.length > 0 && (
        <Alert variant='warning'>
          <AlertTitle>
            <TriangleAlert />
            Some numbers can't send US SMS
          </AlertTitle>
          <AlertDescription className='flex flex-col gap-2'>
            <p>
              Quo restricts US messaging on numbers that aren't registered for it. A restricted
              number still receives messages, but outbound US SMS fails at send time. You can still
              pick one — for inbound-only or non-US use.
            </p>
            <div className='flex flex-wrap gap-1'>
              {restricted.map((number) => (
                <Badge key={number.id} variant='amber'>
                  {number.number}
                </Badge>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {selected?.usRestricted && (
        <p className='text-xs text-muted-foreground'>
          {selected.number} is US-restricted — it can receive messages, but sending to US numbers
          will fail until you register it in Quo.
        </p>
      )}
    </>
  )
}

/**
 * Shell-free Quo connect form embedded in the channel gallery's detail step.
 *
 * One Quo API key covers a whole WORKSPACE with N numbers, so this form has two paths:
 *
 *  - **Existing connection** (default whenever the org already has one). The workspace's numbers
 *    were cached on `Credential.metadata.quo` at connect time, so the picker reads them back via
 *    `channel.quoCachedNumbers` and `channel.addQuoNumber` hangs a second Integration off the
 *    SAME credential. Without this path a user adding their second number re-pastes the key, and
 *    `saveConnection` does not dedupe by providerKey — they would get a second Credential for one
 *    Quo workspace, which is exactly what the workspace-scoped model exists to prevent.
 *  - **New API key** (the only path when no connection exists, and the escape hatch to a genuinely
 *    different workspace). Lists numbers through `channel.quoPhoneNumbers` — a mutation, so the
 *    key never lands in a URL or a query key — then rides `connections.save`'s `postConnect` into
 *    the provisioning hook, which caches the list and creates the Integration for the chosen
 *    number.
 */
export default function QuoConnectForm({ provider, inbox, onSuccess }: QuoConnectFormProps) {
  const [apiKey, setApiKey] = useState('')
  const [numbers, setNumbers] = useState<QuoPhoneNumber[] | null>(null)
  const [phoneNumberId, setPhoneNumberId] = useState('')
  /** Set when the user explicitly opts out of the existing connection. */
  const [useNewKey, setUseNewKey] = useState(false)
  /** Empty = "whatever the first Quo connection is" (the only one, in practice). */
  const [credentialId, setCredentialId] = useState('')

  const quoPhoneNumbers = api.channel.quoPhoneNumbers.useMutation()
  const saveConnection = api.connections.save.useMutation()
  const addQuoNumber = api.channel.addQuoNumber.useMutation()

  // Existing Quo workspace connections. `Credential.type` is the providerKey, so 'openphone'
  // selects them; `kind: ['connection']` excludes app/MCP credentials.
  const connections = api.connections.list.useQuery({ type: 'openphone', kind: ['connection'] })
  const quoConnections = connections.data ?? []
  const hasExisting = quoConnections.length > 0
  const mode: 'existing' | 'new' = hasExisting && !useNewKey ? 'existing' : 'new'
  const activeCredentialId = credentialId || quoConnections[0]?.id || ''
  const activeConnection = quoConnections.find((c) => c.id === activeCredentialId) ?? null

  const cachedNumbers = api.channel.quoCachedNumbers.useQuery(
    { credentialId: activeCredentialId },
    { enabled: mode === 'existing' && activeCredentialId.length > 0 }
  )

  // Numbers that already back a live channel can't become a second one. `channel.list` returns
  // `Integration.metadata`, which is where the routing identity (`phoneNumberId`) lives. Read on
  // BOTH paths — "connect a different workspace" is also how someone re-pastes the same key.
  const channels = api.channel.list.useQuery(undefined)
  const usedIds = useMemo(
    () =>
      new Set(
        (channels.data?.channels ?? [])
          .filter((c) => c.provider === 'openphone')
          .map((c) => (c.metadata as { phoneNumberId?: string } | null)?.phoneNumberId)
          .filter((id): id is string => !!id)
      ),
    [channels.data]
  )

  const connectionOptions = useMemo<SelectOption[]>(
    () => quoConnections.map((c) => ({ value: c.id, label: c.name })),
    [quoConnections]
  )

  const connecting =
    (mode === 'existing' ? addQuoNumber.isPending : saveConnection.isPending) || inbox.creating

  /** A key edit invalidates whatever the previous key listed. */
  function onApiKeyChange(value: string) {
    setApiKey(value)
    setNumbers(null)
    setPhoneNumberId('')
  }

  /** Switch paths. The pick belongs to one workspace, so it never survives the switch. */
  function switchTo(next: 'existing' | 'new') {
    setUseNewKey(next === 'new')
    setPhoneNumberId('')
  }

  function onCredentialChange(value: string) {
    setCredentialId(value)
    setPhoneNumberId('')
  }

  /** Validate the pasted key and list its numbers. A bad key rejects — surface and let them retry. */
  async function findNumbers() {
    try {
      const result = await quoPhoneNumbers.mutateAsync({ apiKey: apiKey.trim() })
      setNumbers(result.numbers)
      // Preselect when the workspace has exactly one number — there is nothing to choose.
      setPhoneNumberId(result.numbers.length === 1 ? (result.numbers[0]?.id ?? '') : '')
    } catch (error) {
      setNumbers(null)
      toastError({
        title: 'Could not read your Quo numbers',
        description: error instanceof Error ? error.message : 'Check the API key and try again.',
      })
    }
  }

  /** New workspace: create the Credential, and let the post-connect hook provision the channel. */
  async function connectWithKey() {
    try {
      const inboxId = await inbox.resolve()
      await saveConnection.mutateAsync({
        // `save` resolves a platform providerKey as the definition id.
        connectionDefinitionId: provider.providerKey,
        name: provider.label,
        values: { apiKey: apiKey.trim() },
        // Forwarded verbatim to the provisioning hook as `ctx.extra`.
        postConnect: { inboxId, phoneNumberId },
      })
      onSuccess()
    } catch (error) {
      toastError({
        title: 'Connection failed',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /** Existing workspace: reuse the credential, add one more Integration for the picked number. */
  async function connectExisting() {
    try {
      const inboxId = await inbox.resolve()
      await addQuoNumber.mutateAsync({
        credentialId: activeCredentialId,
        phoneNumberId,
        inboxId,
      })
      onSuccess()
    } catch (error) {
      toastError({
        title: 'Could not add this number',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  // Hold the paths back until we know whether a connection exists — rendering the API-key form
  // first and swapping it for the existing-connection one a tick later reads as a glitch.
  if (connections.isLoading) {
    return <p className='text-sm text-muted-foreground'>Loading…</p>
  }

  if (mode === 'existing') {
    const cached = cachedNumbers.data?.numbers ?? []
    const cacheEmpty = cachedNumbers.isSuccess && cached.length === 0

    return (
      <div className='flex flex-col gap-4'>
        {connectionOptions.length > 1 ? (
          <FieldPanel orientation='responsive' resizeId={RESIZE_ID} className='p-0'>
            <FieldPanelRow title='Quo connection' type={BaseType.STRING} showIcon isRequired>
              <FieldInputAdapter
                fieldType={FieldType.SINGLE_SELECT}
                fieldOptions={{ options: connectionOptions }}
                value={activeCredentialId}
                onChange={(v) =>
                  onCredentialChange(Array.isArray(v) ? (v[0] ?? '') : ((v as string) ?? ''))
                }
                placeholder='Choose a connection'
                triggerProps={FIELD_TRIGGER_PROPS}
                disabled={connecting}
              />
            </FieldPanelRow>
          </FieldPanel>
        ) : (
          <p className='text-xs text-muted-foreground'>
            Using your existing Quo connection
            {activeConnection ? ` (${activeConnection.name})` : ''}. One key covers the whole
            workspace, so there is no key to paste again.
          </p>
        )}

        {cachedNumbers.isLoading && (
          <p className='text-sm text-muted-foreground'>Loading your numbers…</p>
        )}

        {cacheEmpty && (
          <Alert variant='warning'>
            <AlertTitle>
              <TriangleAlert />
              No numbers cached for this connection
            </AlertTitle>
            <AlertDescription>
              This connection was made before we started caching its workspace numbers. Paste the
              API key once more to refresh the list — it will be cached from then on.
            </AlertDescription>
          </Alert>
        )}

        {cached.length > 0 && (
          <QuoNumberPicker
            numbers={cached}
            value={phoneNumberId}
            onChange={setPhoneNumberId}
            usedIds={usedIds}
            disabled={connecting}
          />
        )}

        {cached.length > 0 && cachedNumbers.data?.fetchedAt && (
          // The cache refreshes whenever a number is provisioned, so it can lag a number added
          // in Quo since. Say when it was read rather than leaving a missing number unexplained.
          <p className='text-xs text-muted-foreground'>
            Numbers read from Quo on {new Date(cachedNumbers.data.fetchedAt).toLocaleDateString()}.
            Added a number since? Connect it with your API key.
          </p>
        )}

        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={() => switchTo('new')}
            disabled={connecting}>
            {cacheEmpty ? 'Use an API key' : 'Connect a different workspace'}
          </Button>
          {!cacheEmpty && (
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() => void connectExisting()}
              disabled={!inbox.isValid || !phoneNumberId || connecting}
              loading={connecting}
              loadingText='Connecting…'>
              Connect
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      <FieldPanel orientation='responsive' resizeId={RESIZE_ID} className='p-0'>
        <FieldPanelRow title='API Key' type={BaseType.STRING} showIcon isRequired>
          <FieldInputAdapter
            fieldType={FieldType.TEXT}
            fieldOptions={{ secret: true }}
            value={apiKey}
            onChange={(v) => onApiKeyChange((v as string) ?? '')}
            placeholder='Your Quo API key'
            disabled={connecting}
          />
        </FieldPanelRow>
      </FieldPanel>

      <p className='text-xs text-muted-foreground'>
        Create a key in Quo under Workspace Settings → API (owner or admin only). One key covers
        your whole workspace — pick which of its numbers this channel uses below.
      </p>

      {!numbers && (
        <div className='flex justify-end'>
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() => void findNumbers()}
            disabled={apiKey.trim().length === 0 || quoPhoneNumbers.isPending}
            loading={quoPhoneNumbers.isPending}
            loadingText='Checking key…'>
            Find my numbers
          </Button>
        </div>
      )}

      {numbers?.length === 0 && (
        <Alert variant='warning'>
          <AlertTitle>
            <TriangleAlert />
            No phone numbers on this workspace
          </AlertTitle>
          <AlertDescription>
            This key is valid but its Quo workspace has no phone numbers. Add one in Quo, then try
            again.
          </AlertDescription>
        </Alert>
      )}

      {!!numbers?.length && (
        <QuoNumberPicker
          numbers={numbers}
          value={phoneNumberId}
          onChange={setPhoneNumberId}
          usedIds={usedIds}
          disabled={connecting}
        />
      )}

      <div className='flex justify-end gap-2'>
        {hasExisting && (
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={() => switchTo('existing')}
            disabled={connecting}>
            Use your existing connection
          </Button>
        )}
        {!!numbers?.length && (
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={() => void findNumbers()}
            disabled={quoPhoneNumbers.isPending || connecting}>
            Refresh numbers
          </Button>
        )}
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={() => void connectWithKey()}
          disabled={!inbox.isValid || !phoneNumberId || connecting}
          loading={connecting}
          loadingText='Connecting…'>
          Connect
        </Button>
      </div>
    </div>
  )
}
