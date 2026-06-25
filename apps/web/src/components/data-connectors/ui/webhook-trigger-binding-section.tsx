// apps/web/src/components/data-connectors/ui/webhook-trigger-binding-section.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Section } from '@auxx/ui/components/section'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { Plus, Webhook, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import {
  type TriggerSource,
  TriggerSourcePicker,
  TriggerSourceRow,
  useTriggerSources,
} from '~/components/pickers/trigger-source'
import { WebhookEndpointInspector } from '~/components/webhooks/ui/webhook-endpoint-inspector'
import { WebhookTopicPicker } from '~/components/webhooks/ui/webhook-topic-picker'
import { AppTriggerTestSection } from '~/components/workflow/apps/trigger/app-trigger-test-section'
import { api, type RouterOutputs } from '~/trpc/react'

type Connector = NonNullable<RouterOutputs['dataConnector']['getById']>
type Stream = RouterOutputs['dataConnector']['listStreams'][number]

/** The persisted webhookTrigger block, mirrored from the lib StreamWebhookTrigger. */
type WebhookTriggerConfig = {
  triggerId?: string
  webhookEndpointId?: string
  filter?: Record<string, unknown>
  tokens: Record<string, string>
  deleteWhen?: { tokenTruthy?: string } | { topicEquals?: string }
  deleteExternalIdPath?: string
  resultShape?: 'single' | 'collection'
}

type TokenRow = { token: string; path: string }
type DeleteMode = 'none' | 'topic' | 'field'

/** The bound signal: an app trigger OR a generic webhook endpoint (exactly one). */
type BoundSource =
  | { kind: 'app'; triggerId: string }
  | { kind: 'webhook-endpoint'; webhookEndpointId: string }

function savedSource(saved: WebhookTriggerConfig | undefined): BoundSource | null {
  if (saved?.webhookEndpointId) {
    return { kind: 'webhook-endpoint', webhookEndpointId: saved.webhookEndpointId }
  }
  if (saved?.triggerId) return { kind: 'app', triggerId: saved.triggerId }
  return null
}

/**
 * Webhook-sync stream binding (unified-trigger-picker §4.2). Shown when the connector's
 * `syncBehavior` is `webhook`: pick which signal drives this stream — an installed-app
 * webhook trigger OR a generic WebhookEndpoint — via the shared `TriggerSourcePicker`, map
 * payload tokens that steer the fetch, optionally scope by topic, and (for app triggers)
 * watch live deliveries through the app-trigger inspector. Persists into the stream's
 * `requestConfig.webhookTrigger` (merged — never clobbers the request).
 */
export function WebhookTriggerBindingSection({
  connector,
  stream,
}: {
  connector: Connector
  stream: Stream
}) {
  const { appInstallations, appConnections } = useAppsContext()

  // Resolve the app installation behind this connector's connection (if any) so app
  // triggers can be scoped to it. Endpoints are app-less, so this may be null.
  const installationId = useMemo(() => {
    if (connector.appInstallationId) return connector.appInstallationId
    const conn = appConnections.find((c) => c.id === connector.credentialId)
    return conn?.appInstallationId ?? null
  }, [connector.appInstallationId, connector.credentialId, appConnections])

  const appId = useMemo(
    () => appInstallations.find((i) => i.installationId === installationId)?.app.id,
    [appInstallations, installationId]
  )

  // Resolve display names + the selected app trigger's output schema from the same
  // sources the picker lists, so the saved binding renders a label not a raw id.
  const { appSources, endpointSources } = useTriggerSources({
    surface: 'workflow',
    appIdFilter: appId,
  })

  const saved = (stream.requestConfig as { webhookTrigger?: WebhookTriggerConfig } | null)
    ?.webhookTrigger

  const [source, setSource] = useState<BoundSource | null>(() => savedSource(saved))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [rows, setRows] = useState<TokenRow[]>(() =>
    saved?.tokens && Object.keys(saved.tokens).length > 0
      ? Object.entries(saved.tokens).map(([token, path]) => ({ token, path }))
      : [{ token: '', path: '' }]
  )
  const [topics, setTopics] = useState<string[]>(() => topicListFromFilter(saved?.filter))
  // Delete-event binding: how a delivery is recognized as a delete (skip the fetch,
  // archive by externalId) — `topic` matches the multiplexed topic, `field` tests a
  // truthy payload path. `deleteIdPath` is the resource id to archive.
  const [deleteMode, setDeleteMode] = useState<DeleteMode>(() => deleteModeFromSaved(saved))
  const [deleteValue, setDeleteValue] = useState(() => deleteValueFromSaved(saved))
  const [deleteIdPath, setDeleteIdPath] = useState(saved?.deleteExternalIdPath ?? '')

  const setStreamRequestConfig = api.dataConnector.setStreamRequestConfig.useMutation({
    onError: (e) => toastError({ title: 'Error saving webhook binding', description: e.message }),
  })
  const utils = api.useUtils()

  const selectedAppTrigger =
    source?.kind === 'app'
      ? (appSources.find((s) => s.trigger.triggerId === source.triggerId)?.trigger ?? null)
      : null
  const selectedEndpoint =
    source?.kind === 'webhook-endpoint'
      ? (endpointSources.find((s) => s.endpoint.id === source.webhookEndpointId)?.endpoint ?? null)
      : null

  const sourceLabel =
    source?.kind === 'app'
      ? (selectedAppTrigger?.label ?? source.triggerId)
      : source?.kind === 'webhook-endpoint'
        ? (selectedEndpoint?.name ?? source.webhookEndpointId)
        : null

  // The app trigger's declared output fields (the `triggerData` envelope it emits, e.g.
  // `resourceId`, `updatedAt`, `topic`, `payload`) — suggested in the token + delete path
  // pickers. Empty for endpoints (raw body) and until the app declares `schema.outputs`.
  const suggestedPaths = useMemo(
    () => Object.keys(selectedAppTrigger?.outputsJsonSchema ?? {}),
    [selectedAppTrigger]
  )

  // Scope the live inspector to the bound topic when the binding targets exactly one;
  // multiple (or none) ⇒ show every delivery to the endpoint.
  const singleTopic = useMemo(() => {
    const list = topics.map((s) => s.trim()).filter(Boolean)
    return list.length === 1 ? list[0] : undefined
  }, [topics])

  const handlePick = (picked: TriggerSource) => {
    if (picked.kind === 'app') setSource({ kind: 'app', triggerId: picked.trigger.triggerId })
    else setSource({ kind: 'webhook-endpoint', webhookEndpointId: picked.endpoint.id })
    setPickerOpen(false)
  }

  const handleSave = async () => {
    if (!source) {
      toastError({ title: 'Pick a trigger' })
      return
    }
    const tokens: Record<string, string> = {}
    for (const { token, path } of rows) {
      const t = token.trim()
      const p = path.trim()
      if (t && p) tokens[t] = p
    }
    const topicList = topics.map((s) => s.trim()).filter(Boolean)
    const deleteWhen =
      deleteMode === 'topic' && deleteValue.trim()
        ? { topicEquals: deleteValue.trim() }
        : deleteMode === 'field' && deleteValue.trim()
          ? { tokenTruthy: deleteValue.trim() }
          : undefined
    const webhookTrigger: WebhookTriggerConfig = {
      ...(source.kind === 'app'
        ? { triggerId: source.triggerId }
        : { webhookEndpointId: source.webhookEndpointId }),
      tokens,
      ...(topicList.length > 0 ? { filter: { topic: { in: topicList } } } : {}),
      ...(deleteWhen ? { deleteWhen } : {}),
      ...(deleteWhen && deleteIdPath.trim() ? { deleteExternalIdPath: deleteIdPath.trim() } : {}),
    }
    // Merge onto the existing request config so path/params/pagination survive.
    const existing = (stream.requestConfig ?? {}) as Record<string, unknown>
    await setStreamRequestConfig.mutateAsync({
      streamId: stream.id,
      requestConfig: { ...existing, webhookTrigger },
      syncMode: 'webhook',
    })
    await utils.dataConnector.listStreams.invalidate({ id: connector.id })
  }

  const addRow = () => setRows((r) => [...r, { token: '', path: '' }])
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i))
  const updateRow = (i: number, patch: Partial<TokenRow>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)))

  return (
    <Section
      title='Webhook trigger'
      icon={<Webhook className='size-4' />}
      initialOpen
      description='Which event drives this stream, and how its payload steers the fetch.'>
      <TriggerSourcePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handlePick}
        surface='workflow'
        appIdFilter={appId}
      />

      <div className='flex flex-col gap-4 px-1'>
        <div className='flex flex-col gap-1.5'>
          <Label>Trigger</Label>
          {source && sourceLabel ? (
            <TriggerSourceRow
              icon={<Webhook className='size-4 text-muted-foreground' />}
              title={sourceLabel}
              secondary={selectedEndpoint?.url ?? selectedAppTrigger?.description}
              onEdit={() => setPickerOpen(true)}
              onDelete={() => setSource(null)}
            />
          ) : (
            <Button variant='outline' className='self-start' onClick={() => setPickerOpen(true)}>
              Select a trigger…
            </Button>
          )}
        </div>

        <div className='flex flex-col gap-1.5'>
          <Label>Payload tokens</Label>
          <p className='text-xs text-muted-foreground'>
            Map a token name to a path in the delivery payload. Tokens steer the fetch request —
            reference them as <code>{'{token}'}</code> in the path, params, headers, or body above
            (e.g. <code>orders/{'{orderId}'}.json</code>).
          </p>
          {suggestedPaths.length > 0 && (
            <datalist id={`wt-paths-${stream.id}`}>
              {suggestedPaths.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          )}
          <div className='flex flex-col gap-2'>
            {rows.map((row, i) => (
              <div key={i} className='flex items-center gap-2'>
                <Input
                  placeholder='token (e.g. orderId)'
                  value={row.token}
                  onChange={(e) => updateRow(i, { token: e.target.value })}
                  className='flex-1'
                />
                <span className='text-muted-foreground text-xs'>←</span>
                <Input
                  placeholder='payload path (e.g. resourceId)'
                  list={suggestedPaths.length > 0 ? `wt-paths-${stream.id}` : undefined}
                  value={row.path}
                  onChange={(e) => updateRow(i, { path: e.target.value })}
                  className='flex-1'
                />
                <Button
                  variant='ghost'
                  size='icon-sm'
                  onClick={() => removeRow(i)}
                  disabled={rows.length === 1}>
                  <X />
                </Button>
              </div>
            ))}
          </div>
          <Button variant='outline' size='xs' className='self-start' onClick={addRow}>
            <Plus />
            Add token
          </Button>
        </div>

        <div className='flex flex-col gap-1.5'>
          <Label>Topics (optional)</Label>
          <p className='text-xs text-muted-foreground'>
            Scope this stream to specific topics when one trigger multiplexes many (e.g.{' '}
            <code>orders/create, orders/paid</code>). Leave blank for all.
          </p>
          {source?.kind === 'webhook-endpoint' ? (
            <WebhookTopicPicker
              multi
              endpointId={source.webhookEndpointId}
              value={topics}
              onChange={setTopics}
            />
          ) : (
            <Input
              placeholder='orders/create,orders/paid'
              value={topics.join(',')}
              onChange={(e) => setTopics(e.target.value.split(','))}
            />
          )}
        </div>

        <div className='flex flex-col gap-1.5'>
          <Label>Deletes (optional)</Label>
          <p className='text-xs text-muted-foreground'>
            When a delivery means the record was deleted upstream, skip the fetch and archive the
            synced record instead.
          </p>
          <Select value={deleteMode} onValueChange={(v) => setDeleteMode(v as DeleteMode)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='none'>Never — every delivery is an upsert</SelectItem>
              <SelectItem value='topic'>When the topic equals…</SelectItem>
              <SelectItem value='field'>When a payload field is set…</SelectItem>
            </SelectContent>
          </Select>
          {deleteMode !== 'none' && (
            <>
              <Input
                placeholder={
                  deleteMode === 'topic' ? 'orders/delete' : 'payload path (e.g. deleted_at)'
                }
                list={
                  deleteMode === 'field' && suggestedPaths.length > 0
                    ? `wt-paths-${stream.id}`
                    : undefined
                }
                value={deleteValue}
                onChange={(e) => setDeleteValue(e.target.value)}
              />
              <Input
                placeholder='external id path to archive (e.g. resourceId)'
                list={suggestedPaths.length > 0 ? `wt-paths-${stream.id}` : undefined}
                value={deleteIdPath}
                onChange={(e) => setDeleteIdPath(e.target.value)}
              />
            </>
          )}
        </div>

        <Button
          className='self-start'
          loading={setStreamRequestConfig.isPending}
          loadingText='Saving…'
          onClick={handleSave}>
          Save binding
        </Button>

        {source?.kind === 'app' && installationId && (
          <div className='border-t pt-3'>
            <AppTriggerTestSection installationId={installationId} triggerId={source.triggerId} />
          </div>
        )}

        {source?.kind === 'webhook-endpoint' && (
          <div className='border-t pt-3'>
            <WebhookEndpointInspector
              endpointId={source.webhookEndpointId}
              topic={singleTopic}
              description='Live deliveries to this endpoint matching this binding.'
            />
          </div>
        )}
      </div>
    </Section>
  )
}

/** Which delete-detection mode a saved `deleteWhen` block represents. */
function deleteModeFromSaved(saved: WebhookTriggerConfig | undefined): DeleteMode {
  const dw = saved?.deleteWhen
  if (dw && 'topicEquals' in dw && dw.topicEquals) return 'topic'
  if (dw && 'tokenTruthy' in dw && dw.tokenTruthy) return 'field'
  return 'none'
}

/** The topic value / payload path a saved `deleteWhen` block carries. */
function deleteValueFromSaved(saved: WebhookTriggerConfig | undefined): string {
  const dw = saved?.deleteWhen
  if (dw && 'topicEquals' in dw && dw.topicEquals) return dw.topicEquals
  if (dw && 'tokenTruthy' in dw && dw.tokenTruthy) return dw.tokenTruthy
  return ''
}

/** Pull the topic list out of a saved `{ topic: { in: [...] } }` filter. */
function topicListFromFilter(filter: Record<string, unknown> | undefined): string[] {
  const topic = filter?.topic
  if (topic && typeof topic === 'object' && Array.isArray((topic as { in?: unknown }).in)) {
    return ((topic as { in: unknown[] }).in as unknown[]).map(String)
  }
  if (typeof topic === 'string') return [topic]
  return []
}
