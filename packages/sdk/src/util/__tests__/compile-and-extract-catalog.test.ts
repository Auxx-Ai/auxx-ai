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
    expect(catalog.workflow.triggers).toEqual([
      {
        triggerId: 'on_message_received',
        label: 'Message received',
        description: 'Fires when a new message arrives.',
      },
    ])
    expect(catalog.agent.triggers).toEqual([
      {
        triggerId: 'on_message_received',
        label: 'Message received',
        description: 'New message arrived in a channel.',
        defaultEnabled: true,
      },
    ])

    // Workflow blocks — `toolMap` is the dispatcher table the runtime reads.
    expect(catalog.workflow.blocks).toHaveLength(1)
    expect(catalog.workflow.blocks[0]).toMatchObject({
      id: 'messaging',
      label: 'Messaging',
      description: 'Composite block dispatching to messaging tools.',
      iconKey: null,
      toolMap: {
        'message.send': 'send_message',
      },
    })
  })
})
