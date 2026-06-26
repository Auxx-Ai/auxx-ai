// apps/web/src/components/data-connectors/ui/webhook-steering-section.tsx
'use client'

import { collectSchemaLeaves, type SourceLeaf } from '@auxx/lib/json-schema/client'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Label } from '@auxx/ui/components/label'
import { Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import TreeRow from '@auxx/ui/components/tree-row'
import { Table2, Webhook } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAppsContext } from '~/components/apps/providers/apps-context'
import { useTriggerSources } from '~/components/pickers/trigger-source'
import { type Tag, TagInput } from '~/components/tag-input/tag-input'
import { WebhookTopicPicker } from '~/components/webhooks/ui/webhook-topic-picker'
import { api, type RouterOutputs } from '~/trpc/react'
import { useBufferedConfig } from '../hooks/use-buffered-config'
import { useRegisterSaver } from '../hooks/use-connector-edits'

type Connector = NonNullable<RouterOutputs['dataConnector']['getById']>
type Stream = RouterOutputs['dataConnector']['listStreams'][number]

/** The persisted per-stream STEERING block (signal lives on the connector, v7). */
type WebhookTriggerConfig = {
  filter?: Record<string, unknown>
  /** Payload paths exposed as `{path}` placeholders (the path IS the placeholder). */
  paths: string[]
  deleteWhen?: { tokenTruthy?: string } | { topicEquals?: string }
  deleteExternalIdPath?: string
  resultShape?: 'single' | 'collection'
}

/** The connector-level signal (resolved for payload-path schema suggestions). */
type WebhookSignal = { triggerId?: string; webhookEndpointId?: string }

type DeleteMode = 'none' | 'topic' | 'field'

/** The editable steering fields, buffered behind the connector-wide save bar. */
type SteeringDraft = {
  /** Payload paths exposed as `{path}` placeholders for the fetch. */
  paths: string[]
  topics: string[]
  deleteMode: DeleteMode
  deleteValue: string
  deleteIdPath: string
}

/**
 * Webhook STEERING section (v7) — how matched deliveries steer each stream's fetch (topic
 * scope, payload `{path}` fields). The connector's SIGNAL (which trigger/endpoint) is
 * picked once at the connector level ({@link WebhookSignalSection}); steering is per-stream.
 * A single-stream connector (the common case) renders its editor inline; a multi-stream
 * connector renders one expandable {@link TreeRow} per stream. Each open editor registers its
 * own saver, so it commits through the one connector-wide save bar. Rendered on the connector
 * page (Schedule section) for webhook-sync generic-REST connectors.
 *
 * NOTE: collapsing a row unmounts its editor (TreeRow's expand mechanism), so an unsaved draft
 * on that row is discarded — save (the connector bar) before collapsing.
 */
export function WebhookSteeringSection({
  connector,
  streams,
}: {
  connector: Connector
  streams: Stream[]
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Single-stream connectors steer inline — no row to expand.
  if (streams.length === 1) {
    return (
      <Section
        title='Webhook steering'
        icon={<Webhook className='size-4' />}
        initialOpen
        description='How a matched delivery steers this stream’s fetch.'>
        <WebhookSteeringEditor connector={connector} stream={streams[0]!} />
      </Section>
    )
  }

  return (
    <Section
      title='Webhook steering'
      icon={<Webhook className='size-4' />}
      initialOpen
      collapsible={false}
      description='How a matched delivery steers each stream’s fetch.'>
      <div className='flex flex-col px-1'>
        {streams.map((stream) => (
          <TreeRow
            key={stream.id}
            icon={<Table2 className='size-4' />}
            title={stream.streamKey ?? 'Untitled stream'}
            secondary={steeringSummary(stream)}
            secondaryFill
            expandable
            isOpen={openIds.has(stream.id)}
            onToggleOpen={() => toggle(stream.id)}>
            <div className='ps-5 pe-1 pb-3 pt-1'>
              <WebhookSteeringEditor connector={connector} stream={stream} />
            </div>
          </TreeRow>
        ))}
      </div>
    </Section>
  )
}

/**
 * The per-stream steering form body (no `Section` wrapper). The connector's SIGNAL (which
 * trigger/endpoint) is picked once at the connector level ({@link WebhookSignalSection}); here we
 * declare how a matched delivery steers THIS stream's fetch: scope by topic, then pick which
 * payload fields to expose as `{path}` placeholders (checklist driven by the bound signal's
 * schema — the app trigger's outputs, or the scoped topics' per-topic schema; off-schema paths
 * can be added by hand). The path IS the placeholder — no rename. Generic-REST only (app fetches
 * ignore steering). Persists into the stream's `requestConfig.webhookTrigger` (merged) behind the
 * connector save bar.
 */
function WebhookSteeringEditor({ connector, stream }: { connector: Connector; stream: Stream }) {
  const { appInstallations, appConnections } = useAppsContext()

  const installationId = useMemo(() => {
    if (connector.appInstallationId) return connector.appInstallationId
    const conn = appConnections.find((c) => c.id === connector.credentialId)
    return conn?.appInstallationId ?? null
  }, [connector.appInstallationId, connector.credentialId, appConnections])

  const appId = useMemo(
    () => appInstallations.find((i) => i.installationId === installationId)?.app.id,
    [appInstallations, installationId]
  )

  // Resolve the bound signal's schema + endpoint topics from the same sources the picker lists.
  const { appSources, endpointSources } = useTriggerSources({
    surface: 'workflow',
    appIdFilter: appId,
  })

  const signal = (connector.config as { webhookTrigger?: WebhookSignal } | null)?.webhookTrigger
  const selectedAppTrigger = signal?.triggerId
    ? (appSources.find((s) => s.trigger.triggerId === signal.triggerId)?.trigger ?? null)
    : null
  const selectedEndpoint = signal?.webhookEndpointId
    ? (endpointSources.find((s) => s.endpoint.id === signal.webhookEndpointId)?.endpoint ?? null)
    : null

  const saved = (stream.requestConfig as { webhookTrigger?: WebhookTriggerConfig } | null)
    ?.webhookTrigger

  const setStreamRequestConfig = api.dataConnector.setStreamRequestConfig.useMutation({
    onError: (e) => toastError({ title: 'Error saving webhook binding', description: e.message }),
  })
  const utils = api.useUtils()

  // One buffered draft behind the connector-wide save bar — no per-section Save
  // button. `paths`/`topics` are the edited fields. The `delete*` fields are kept in the
  // draft (initialized from / persisted back to `saved`) so any existing delete config
  // round-trips, but their editor is intentionally hidden from the UI for now.
  const draft = useBufferedConfig<SteeringDraft>(
    {
      paths: saved?.paths ?? [],
      topics: topicListFromFilter(saved?.filter),
      deleteMode: deleteModeFromSaved(saved),
      deleteValue: deleteValueFromSaved(saved),
      deleteIdPath: saved?.deleteExternalIdPath ?? '',
    },
    (value) => persist(value),
    { mode: 'manual' }
  )
  const { paths, topics } = draft.value

  // Feeds the connector-wide save bar; no per-section Save button.
  useRegisterSaver(
    `webhook-steering:${stream.id}`,
    draft.isDirty,
    setStreamRequestConfig.isPending,
    draft.commit
  )

  // Flatten the bound signal's schema into pickable dotted leaves (incl. scalar arrays —
  // a `{path}` comma-joins them). App trigger → its `outputsJsonSchema`; endpoint → the
  // union of the scoped topics' schemas (all topics when none is scoped). Empty ⇒ the
  // checklist is empty and only the manual add remains.
  const leaves = useMemo<SourceLeaf[]>(() => {
    if (selectedAppTrigger?.outputsJsonSchema) {
      return collectSchemaLeaves(selectedAppTrigger.outputsJsonSchema, {
        includeScalarArrays: true,
      })
    }
    if (selectedEndpoint) {
      const scope = topics.map((s) => s.trim()).filter(Boolean)
      const merged = new Map<string, SourceLeaf>()
      for (const t of selectedEndpoint.topics ?? []) {
        if (!t.schema) continue
        if (scope.length > 0 && !scope.includes(t.key)) continue
        for (const leaf of collectSchemaLeaves(t.schema, { includeScalarArrays: true })) {
          merged.set(leaf.path, leaf)
        }
      }
      return [...merged.values()]
    }
    return []
  }, [selectedAppTrigger, selectedEndpoint, topics])

  const leafPaths = useMemo(() => new Set(leaves.map((l) => l.path)), [leaves])
  const selected = useMemo(() => new Set(paths), [paths])

  const [topicTagIndex, setTopicTagIndex] = useState<number | null>(null)
  const [pathTagIndex, setPathTagIndex] = useState<number | null>(null)

  // Schema leaves drive the checklist; any selected path that ISN'T a schema leaf is an
  // off-schema path, surfaced as a free TagInput so it stays editable.
  const topicTags = useMemo<Tag[]>(() => topics.map((t) => ({ id: t, text: t })), [topics])
  const customTags = useMemo<Tag[]>(
    () => paths.filter((p) => !leafPaths.has(p)).map((p) => ({ id: p, text: p })),
    [paths, leafPaths]
  )

  const setTopics = (next: string[]) => draft.set({ ...draft.value, topics: next })
  const setTopicTags = (next: Tag[] | ((prev: Tag[]) => Tag[])) => {
    const list = typeof next === 'function' ? next(topicTags) : next
    setTopics([...new Set(list.map((t) => t.text.trim()).filter(Boolean))])
  }
  const togglePath = (path: string) =>
    draft.set({
      ...draft.value,
      paths: selected.has(path) ? paths.filter((p) => p !== path) : [...paths, path],
    })
  // The TagInput owns the off-schema paths; keep the schema-selected ones and swap the rest.
  const setCustomTags = (next: Tag[] | ((prev: Tag[]) => Tag[])) => {
    const list = typeof next === 'function' ? next(customTags) : next
    const custom = [...new Set(list.map((t) => t.text.trim()).filter(Boolean))]
    const schemaSelected = paths.filter((p) => leafPaths.has(p))
    draft.set({ ...draft.value, paths: [...schemaSelected, ...custom] })
  }

  // Build the steering block from the draft and merge it onto the stream's request
  // config (never clobbers path/params/pagination), then refresh the streams list.
  const persist = (value: SteeringDraft) => {
    const pathList = [...new Set(value.paths.map((p) => p.trim()).filter(Boolean))]
    const topicList = value.topics.map((s) => s.trim()).filter(Boolean)
    const deleteWhen =
      value.deleteMode === 'topic' && value.deleteValue.trim()
        ? { topicEquals: value.deleteValue.trim() }
        : value.deleteMode === 'field' && value.deleteValue.trim()
          ? { tokenTruthy: value.deleteValue.trim() }
          : undefined
    const webhookTrigger: WebhookTriggerConfig = {
      paths: pathList,
      ...(topicList.length > 0 ? { filter: { topic: { in: topicList } } } : {}),
      ...(deleteWhen ? { deleteWhen } : {}),
      ...(deleteWhen && value.deleteIdPath.trim()
        ? { deleteExternalIdPath: value.deleteIdPath.trim() }
        : {}),
    }
    const existing = (stream.requestConfig ?? {}) as Record<string, unknown>
    // Steering lives in `requestConfig.webhookTrigger`; `syncMode` stays the completeness
    // axis (snapshot/incremental) so a steered stream can still reconcile on its sweeps.
    return setStreamRequestConfig
      .mutateAsync({
        streamId: stream.id,
        requestConfig: { ...existing, webhookTrigger },
      })
      .then(() => utils.dataConnector.listStreams.invalidate({ id: connector.id }))
  }

  return (
    <div className='flex flex-col gap-4 px-1'>
      {!signal && (
        <p className='text-xs text-muted-foreground'>
          Pick the connector’s webhook trigger in the Schedule section first — payload fields come
          from its schema.
        </p>
      )}

      <div className='flex items-start justify-between gap-4'>
        <div className='flex flex-col gap-1.5'>
          <Label>Topics (optional)</Label>
          <p className='text-xs text-muted-foreground'>
            Scope this stream to specific topics when one trigger multiplexes many (e.g.{' '}
            <code>orders/create, orders/paid</code>). Leave blank for all.
          </p>
        </div>
        <div className='w-40 shrink-0'>
          {selectedEndpoint ? (
            <WebhookTopicPicker
              multi
              endpointId={selectedEndpoint.id}
              value={topics}
              onChange={setTopics}
            />
          ) : (
            <TagInput
              tags={topicTags}
              setTags={setTopicTags}
              activeTagIndex={topicTagIndex}
              setActiveTagIndex={setTopicTagIndex}
              placeholder='Type a topic and press Enter'
              size='sm'
              styleClasses={{ inlineTagsContainer: 'min-h-9 bg-background' }}
            />
          )}
        </div>
      </div>

      <div className='flex flex-col gap-1.5'>
        <Label>Payload fields</Label>
        <p className='text-xs text-muted-foreground'>
          Pick fields from the delivery payload to expose as <code>{'{path}'}</code> placeholders.
          Reference them in the request URL, params, headers, or body above — e.g.{' '}
          <code>orders/{'{id}'}.json</code>.
        </p>
        {leaves.length > 0 && (
          <div className='flex max-h-56 flex-col gap-0.5 overflow-auto rounded-md border p-1'>
            {leaves.map((leaf) => (
              <label
                key={leaf.path}
                className='flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-background'>
                <Checkbox
                  checked={selected.has(leaf.path)}
                  onCheckedChange={() => togglePath(leaf.path)}
                />
                <code className='text-foreground text-xs'>{leaf.path}</code>
                <span className='text-[10px] text-muted-foreground'>{leaf.jsonType}</span>
              </label>
            ))}
          </div>
        )}
        <TagInput
          tags={customTags}
          setTags={setCustomTags}
          activeTagIndex={pathTagIndex}
          setActiveTagIndex={setPathTagIndex}
          placeholder={
            leaves.length > 0
              ? 'Add an off-schema path…'
              : 'Type a payload path (e.g. resourceId) and press Enter'
          }
          size='sm'
          styleClasses={{ inlineTagsContainer: 'min-h-9 bg-background' }}
        />
      </div>
    </div>
  )
}

/** One-line summary of a stream's saved steering, for the collapsed row. */
function steeringSummary(stream: Stream) {
  const wt = (stream.requestConfig as { webhookTrigger?: WebhookTriggerConfig } | null)
    ?.webhookTrigger
  const fieldCount = wt?.paths?.length ?? 0
  const topics = topicListFromFilter(wt?.filter)
  if (fieldCount === 0 && topics.length === 0) {
    return <span className='text-muted-foreground'>not configured</span>
  }
  const fieldPart = `${fieldCount} ${fieldCount === 1 ? 'field' : 'fields'}`
  const topicPart = topics.length > 0 ? topics.join(', ') : 'all topics'
  return `${fieldPart} · ${topicPart}`
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
