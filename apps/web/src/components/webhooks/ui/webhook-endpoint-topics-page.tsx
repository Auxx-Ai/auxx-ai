// apps/web/src/components/webhooks/ui/webhook-endpoint-topics-page.tsx
'use client'

import type { WebhookEndpointTopic } from '@auxx/database'
import { inferJsonSchema } from '@auxx/lib/json-schema/client'
import { AutosizeInput } from '@auxx/ui/components/autosize-input'
import { Button } from '@auxx/ui/components/button'
import { DialogFooter } from '@auxx/ui/components/dialog'
import { EmptySection, Section } from '@auxx/ui/components/section'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { generateId } from '@auxx/utils/generateId'
import { Braces, Plus, Tags, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CodeEditor, CodeLanguage } from '~/components/workflow/ui/code-editor'
import { useConfirm } from '~/hooks/use-confirm'
import { useWebhookEndpoint, type WebhookEndpointRow } from '../hooks/use-webhook-endpoint'
import type { WebhookEndpointTestEvent } from '../hooks/use-webhook-endpoint-events'
import { WebhookEndpointInspector } from './webhook-endpoint-inspector'

interface WebhookEndpointTopicsPageProps {
  endpoint: WebhookEndpointRow
  onBack: () => void
}

/** Schema-state label for a topic's `secondary` badge. */
function schemaBadge(topic: WebhookEndpointTopic): { label: string; muted: boolean } {
  if (!topic.schema) return { label: 'No schema', muted: true }
  return { label: topic.schemaSource === 'manual' ? 'Manual' : 'Inferred', muted: false }
}

/**
 * The "Setup topics" page (plans/data-connectors/v6/webhook-endpoint-topics-plan.md §4): a
 * `TreeRow` list of the endpoint's declared topics (key edited inline via `AutosizeInput`,
 * schema-state badge, hover delete), ONE shared `CodeEditor` below the list showing the
 * selected topic's payload schema, and the live Deliveries inspector — whose per-delivery
 * "Use shape as schema" action infers a JSON Schema from a captured payload and assigns it
 * to the matching topic (auto-creating it). Only reachable when the endpoint extracts a topic.
 */
export function WebhookEndpointTopicsPage({ endpoint, onBack }: WebhookEndpointTopicsPageProps) {
  const { update } = useWebhookEndpoint()
  const [confirm, ConfirmDialog] = useConfirm()

  const [topics, setTopics] = useState<WebhookEndpointTopic[]>(() => endpoint.topics ?? [])
  const [selectedId, setSelectedId] = useState<string | null>(
    () => endpoint.topics?.[0]?.id ?? null
  )
  const [adding, setAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  // Schema-editor state: an editing buffer keeps invalid intermediate JSON out of the model.
  const [editing, setEditing] = useState(false)
  const [buffer, setBuffer] = useState('')

  const selected = useMemo(
    () => topics.find((t) => t.id === selectedId) ?? null,
    [topics, selectedId]
  )

  const select = (id: string) => {
    setSelectedId(id)
    setEditing(false)
  }

  const patchTopic = (id: string, patch: Partial<WebhookEndpointTopic>) =>
    setTopics((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const addTopic = () => {
    const key = newKey.trim()
    setAdding(false)
    setNewKey('')
    if (!key) return
    if (topics.some((t) => t.key === key)) {
      // Just select the existing one rather than erroring on a dup.
      const existing = topics.find((t) => t.key === key)
      if (existing) select(existing.id)
      return
    }
    const topic: WebhookEndpointTopic = { id: generateId(), key }
    setTopics((prev) => [...prev, topic])
    select(topic.id)
  }

  const deleteTopic = async (topic: WebhookEndpointTopic) => {
    const ok = await confirm({
      title: `Delete topic "${topic.key}"?`,
      description: 'Its schema will be removed. This cannot be undone.',
      confirmText: 'Delete',
      destructive: true,
    })
    if (!ok) return
    setTopics((prev) => prev.filter((t) => t.id !== topic.id))
    if (selectedId === topic.id) {
      setSelectedId((prev) => topics.find((t) => t.id !== topic.id)?.id ?? null)
      setEditing(false)
    }
  }

  /** Infer a schema from a captured delivery and assign it to the matching topic (creating it). */
  const applyEventShape = (event: WebhookEndpointTestEvent) => {
    const key = event.topic.trim()
    if (!key) {
      toastError({
        title: 'No topic on this delivery',
        description: 'This delivery carried no extracted topic to attach a schema to.',
      })
      return
    }
    const schema = inferJsonSchema(event.triggerData) as Record<string, unknown>
    const existing = topics.find((t) => t.key === key)
    if (existing) {
      patchTopic(existing.id, { schema, schemaSource: 'inferred', sampleEventId: event.eventId })
      select(existing.id)
    } else {
      const topic: WebhookEndpointTopic = {
        id: generateId(),
        key,
        schema,
        schemaSource: 'inferred',
        sampleEventId: event.eventId,
      }
      setTopics((prev) => [...prev, topic])
      select(topic.id)
    }
  }

  const startEditSchema = () => {
    if (!selected) return
    setBuffer(selected.schema ? JSON.stringify(selected.schema, null, 2) : '{\n  \n}')
    setEditing(true)
  }

  const applySchema = () => {
    if (!selected) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(buffer)
    } catch {
      toastError({ title: 'Invalid JSON', description: 'The schema must be valid JSON.' })
      return
    }
    patchTopic(selected.id, { schema: parsed, schemaSource: 'manual' })
    setEditing(false)
  }

  const save = () => {
    update.mutate({ id: endpoint.id, topics }, { onSuccess: onBack })
  }

  return (
    <div className='flex flex-col p-0'>
      {/* Topic list */}
      <Section
        title='Topics'
        icon={<Tags className='size-4' />}
        collapsible={false}
        actions={
          !adding && (
            <Button variant='ghost' size='xs' onClick={() => setAdding(true)}>
              <Plus />
              Add topic
            </Button>
          )
        }>
        {topics.length === 0 && !adding && (
          <EmptySection
            icon={<Tags className='size-5' />}
            title='No topics yet'
            description='Add a topic, or capture a delivery below and use its shape.'
          />
        )}
        {topics.map((topic) => {
          const badge = schemaBadge(topic)
          return (
            <TreeRow
              key={topic.id}
              icon={<Tags className='size-4' />}
              isOpen={selectedId === topic.id}
              onToggleOpen={() => select(topic.id)}
              rowClassName={selectedId === topic.id ? 'bg-background' : undefined}
              title={
                <AutosizeInput
                  value={topic.key}
                  onChange={(e) => patchTopic(topic.id, { key: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  placeholder='topic.key'
                  inputClassName='bg-transparent text-sm text-foreground outline-none'
                  minWidth={40}
                />
              }
              secondary={
                <span
                  className={`inline-flex items-center rounded border px-1 text-[10px] font-medium uppercase tracking-wide ${
                    badge.muted ? 'text-muted-foreground' : 'text-foreground'
                  }`}>
                  {badge.label}
                </span>
              }
              actions={
                <TreeRowButton
                  variant='destructive'
                  tooltipText='Delete topic'
                  onClick={() => void deleteTopic(topic)}>
                  <Trash2 />
                </TreeRowButton>
              }
            />
          )
        })}

        {adding && (
          <div className='flex items-center gap-2 px-1 py-1'>
            <Tags className='size-4 text-muted-foreground' />
            <AutosizeInput
              autoFocus
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              onBlur={addTopic}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTopic()
                if (e.key === 'Escape') {
                  setAdding(false)
                  setNewKey('')
                }
              }}
              placeholder='payment_intent.succeeded'
              inputClassName='bg-transparent text-sm text-foreground outline-none'
              minWidth={80}
            />
          </div>
        )}
      </Section>

      {/* Shared schema editor — selected topic's payload schema */}
      <Section
        title={selected ? `Schema · ${selected.key}` : 'Schema'}
        icon={<Braces className='size-4' />}
        collapsible={false}
        actions={
          selected &&
          (editing ? (
            <div className='flex items-center gap-1'>
              <Button variant='ghost' size='xs' onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button variant='outline' size='xs' onClick={applySchema}>
                Apply
              </Button>
            </div>
          ) : (
            <Button variant='ghost' size='xs' onClick={startEditSchema}>
              {selected.schema ? 'Edit schema' : 'Add schema'}
            </Button>
          ))
        }>
        {!selected ? (
          <EmptySection
            icon={<Braces className='size-5' />}
            title='No topic selected'
            description='Select a topic to view its schema.'
          />
        ) : editing ? (
          <CodeEditor
            value={buffer}
            onChange={setBuffer}
            language={CodeLanguage.json}
            minHeight={140}
            title='SCHEMA'
            gradientBorder={false}
          />
        ) : selected.schema ? (
          <CodeEditor
            value={JSON.stringify(selected.schema, null, 2)}
            language={CodeLanguage.json}
            readOnly
            minHeight={140}
            title='SCHEMA'
            gradientBorder={false}
          />
        ) : (
          <EmptySection
            icon={<Braces className='size-5' />}
            title='No schema yet'
            description='Capture a delivery below and use its shape, or add one manually.'
          />
        )}
      </Section>

      {/* Live deliveries — capture a payload to infer a topic's schema */}
      <WebhookEndpointInspector
        endpointId={endpoint.id}
        title='Deliveries'
        description='Live deliveries to this endpoint (kept for ~5 minutes). Use a delivery to define a topic schema.'
        initialOpen
        onUseEventShape={applyEventShape}
      />

      <DialogFooter className='py-2 pe-3'>
        <Button
          variant='outline'
          size='sm'
          type='button'
          onClick={save}
          loading={update.isPending}
          loadingText='Saving...'>
          Save topics
        </Button>
      </DialogFooter>
      <ConfirmDialog />
    </div>
  )
}
