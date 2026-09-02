// packages/sdk/src/util/__tests__/compile-and-extract-catalog.test.ts

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isComplete } from '../../errors.js'
import { compileAndExtractCatalog } from '../compile-and-extract-catalog.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FIXTURE_DIR = path.resolve(__dirname, '..', '..', '..', '__fixtures__', 'tool-app')

describe('compileAndExtractCatalog', () => {
  let originalCwd: string

  beforeAll(() => {
    originalCwd = process.cwd()
    process.chdir(FIXTURE_DIR)
  })

  afterAll(() => {
    process.chdir(originalCwd)
  })

  it('projects tools, triggers and blocks into the expected catalog shape', async () => {
    const result = await compileAndExtractCatalog()
    expect(isComplete(result)).toBe(true)
    if (!isComplete(result) || !result.value) {
      throw new Error('catalog extraction returned no value')
    }
    const catalog = result.value

    // Roundtrip-serializable: extractor already enforces this, but assert
    // again so the test fails loudly if it ever stops.
    expect(() => JSON.stringify(catalog)).not.toThrow()

    expect(catalog.tools).toHaveLength(1)
    expect(catalog.tools[0]).toMatchObject({
      id: 'send_message',
      name: 'Send message',
      description: 'Send a message to a thread.',
      requiresConnection: true,
      timeoutMs: 20000,
      streaming: false,
    })
    expect(catalog.tools[0]?.inputsJsonSchema).toMatchObject({
      type: 'object',
      properties: {
        threadId: { type: 'string' },
        body: { type: 'string' },
      },
    })

    // exampleOutput rides the catalog verbatim (deep-cloned, serializable).
    expect(catalog.tools[0]?.exampleOutput).toEqual({ messageId: 'msg_abc123' })
    // It also surfaces on the agent projection (CatalogAgentTool extends CatalogTool).
    expect(catalog.agent.tools[0]?.exampleOutput).toEqual({ messageId: 'msg_abc123' })

    expect(catalog.toolsets).toEqual([
      {
        slug: 'app:fixture:messaging',
        name: 'Messaging',
        description: 'Send messages.',
        iconKey: null,
        subGroup: null,
      },
    ])

    // Agent projection — tool with `agent` key surfaces here, toolset slug
    // resolved via toolsets[].tools mapping.
    expect(catalog.agent.tools).toHaveLength(1)
    expect(catalog.agent.tools[0]).toMatchObject({
      id: 'send_message',
      agentName: 'send_message',
      agentDescription: 'Send a chat message. Returns the new message id.',
      toolsetSlug: 'app:fixture:messaging',
      idempotent: false,
    })
    expect(catalog.agent.toolsets).toEqual(catalog.toolsets)

    // Action projection — tool with `action` key surfaces here.
    expect(catalog.actions).toEqual([
      {
        toolId: 'send_message',
        label: 'Send reply',
        description: 'Send a reply to the current ticket.',
        iconKey: null,
        color: undefined,
        surface: 'ticket-header',
        requiresConfirmation: false,
        confirmationMessage: undefined,
      },
    ])

    // Triggers — projected into both workflow.triggers and agent.triggers
    // because the fixture declares both surface keys.
    expect(catalog.triggers).toHaveLength(1)
    expect(catalog.triggers[0]).toMatchObject({
      id: 'on_message_received',
      label: 'Message received',
      description: 'Fires when a new message arrives.',
      iconKey: null,
    })
    expect(catalog.workflow.triggers).toHaveLength(1)
    expect(catalog.workflow.triggers[0]).toMatchObject({
      triggerId: 'on_message_received',
      label: 'Message received',
      description: 'Fires when a new message arrives.',
      iconKey: null,
    })
    expect(catalog.workflow.triggers[0]?.inputsJsonSchema).toBeDefined()
    // Declared `schema.outputs` is projected too — the `triggerData` envelope the
    // trigger emits, so a consumer can offer real, labeled output paths.
    expect(Object.keys(catalog.workflow.triggers[0]?.outputsJsonSchema ?? {})).toEqual([
      'resourceId',
      'topic',
    ])
    expect(catalog.triggers[0]?.outputsJsonSchema?.resourceId).toMatchObject({ type: 'string' })
    expect(catalog.agent.triggers).toHaveLength(1)
    expect(catalog.agent.triggers[0]).toMatchObject({
      triggerId: 'on_message_received',
      label: 'Message received',
      description: 'New message arrived in a channel.',
      iconKey: null,
    })
    expect(catalog.agent.triggers[0]?.inputsJsonSchema).toBeDefined()
    // defaultEnabled removed from projection
    expect(catalog.agent.triggers[0]).not.toHaveProperty('defaultEnabled')

    // Workflow blocks — `toolMap` is the dispatcher table the runtime reads.
    expect(catalog.workflow.blocks).toHaveLength(2)
    expect(catalog.workflow.blocks[0]).toMatchObject({
      id: 'messaging',
      label: 'Messaging',
      description: 'Composite block dispatching to messaging tools.',
      iconKey: null,
      toolMap: {
        'message.send': 'send_message',
      },
    })
    // `schema.outputs` reaches the catalog for blocks, same as it already did
    // for triggers — the compiler used to call only the inputs serializer.
    expect(catalog.workflow.blocks[0]?.outputsJsonSchema).toEqual({
      messageId: { type: 'string', _metadata: { label: 'Message ID' } },
    })
    // Per-operation outputs — `computeOutputs` evaluated once per toolMap key at
    // publish time. This is what gives the server the same per-selection shapes
    // the canvas computes live in the app iframe.
    expect(catalog.workflow.blocks[0]?.opOutputsJsonSchema).toEqual({
      // `channelId`/`userId` are conditional on the `target` select, and appear
      // only because the extractor varies each select input one value at a time
      // and unions. Slack's `message.send`/`sendTo` is the real instance.
      'message.send': {
        messageId: { type: 'string', _metadata: { label: 'Message ID' } },
        sentAt: { type: 'string', _metadata: { label: 'Sent at' } },
        channelId: { type: 'string', _metadata: {} },
        userId: { type: 'string', _metadata: {} },
      },
      'message.react': {
        reactionId: { type: 'string', _metadata: { label: 'Reaction ID' } },
      },
      // Threw. Degraded to `{}` — "unknown shape" — and the publish still
      // succeeded, which is the whole point of catching per key.
      'message.explode': {},
    })

    // `config` members the catalog projects. Carried verbatim, so `false` is
    // preserved and distinguishable from absent.
    expect(catalog.workflow.blocks[0]?.requiresConnection).toBe(true)
    expect(catalog.workflow.blocks[0]?.canRunSingle).toBe(false)

    // A block declaring neither must not acquire the keys at all. `undefined`
    // has to stay distinguishable from `false` — every consumer treats absent
    // as "unknown, fall back", and `false` as "the author said no".
    const bare = catalog.workflow.blocks[1]
    expect(bare?.id).toBe('bare')
    expect(bare).not.toHaveProperty('requiresConnection')
    expect(bare).not.toHaveProperty('canRunSingle')
    expect(bare?.outputsJsonSchema).toEqual({})
    // No `computeOutputs` at all ⇒ an entry per op, each `{}` (unknown), rather
    // than a missing key the reader would have to special-case.
    expect(bare?.opOutputsJsonSchema).toEqual({ 'thing.do': {} })

    // App-registered custom fields — projected from `app.fields[]`. Carries the
    // catalog the platform provisions on install/connect (Phase 5/7).
    expect(catalog.fields).toHaveLength(2)
    expect(catalog.fields?.[0]).toMatchObject({
      key: 'customerId',
      type: 'TEXT',
      targetEntity: 'contact',
      scope: 'connection',
      name: 'Customer ID',
      capabilities: { hidden: true, updatable: false },
    })
    expect(catalog.fields?.[1]).toMatchObject({
      key: 'tier',
      type: 'SINGLE_SELECT',
      targetEntity: 'contact',
      scope: 'installation',
      options: [
        { value: 'gold', label: 'Gold' },
        { value: 'silver', label: 'Silver' },
      ],
    })
  })
})
