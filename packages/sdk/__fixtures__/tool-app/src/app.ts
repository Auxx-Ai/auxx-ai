// packages/sdk/__fixtures__/tool-app/src/app.ts
//
// Fixture exercising the full surface matrix in a single app:
//  - one tool with both `agent` and `action` keys
//  - one trigger with both `workflow` and `agent` surface keys
//  - one workflow block (carrying a `toolMap` dispatcher table)
//  - one toolset grouping the tool
//
// Consumed by `src/util/__tests__/compile-and-extract-catalog.test.ts` to pin
// the catalog projection per impl plan §5.6.

import { defineFields } from '@auxx/sdk/fields'
import { z } from 'zod/v4'
import sendMessage from './send-message.tool.server'

export const app = {
  tools: [
    {
      id: 'send_message',
      name: 'Send message',
      description: 'Send a message to a thread.',
      inputs: z.object({
        threadId: z.string(),
        body: z.string(),
      }),
      outputs: z.object({
        messageId: z.string(),
      }),
      exampleOutput: {
        messageId: 'msg_abc123',
      },
      config: {
        requiresConnection: true,
        timeout: 20000,
      },
      execute: sendMessage,
      agent: {
        name: 'send_message',
        description: 'Send a chat message. Returns the new message id.',
        idempotent: false,
      },
      action: {
        label: 'Send reply',
        description: 'Send a reply to the current ticket.',
        surface: 'ticket-header' as const,
        requiresConfirmation: false,
      },
    },
  ],
  toolsets: [
    {
      id: 'fixture.messaging',
      name: 'Messaging',
      description: 'Send messages.',
      tools: ['send_message'],
    },
  ],
  workflow: {
    blocks: [
      {
        id: 'messaging',
        label: 'Messaging',
        description: 'Composite block dispatching to messaging tools.',
        schema: {
          inputs: {
            resource: {
              toJSON: () => ({ type: 'string', _metadata: { label: 'Resource' } }),
            },
            // A select the outputs condition on — slack's `sendTo` shape.
            target: {
              toJSON: () => ({
                type: 'select',
                _metadata: {
                  label: 'Target',
                  options: [{ value: 'channel' }, { value: 'user' }],
                },
              }),
            },
          },
          outputs: {
            messageId: {
              toJSON: () => ({ type: 'string', _metadata: { label: 'Message ID' } }),
            },
          },
          // Dynamic per-selection outputs — the shape the canvas computes live
          // in the app iframe. `explode` throws, to prove one bad selection
          // degrades to `{}` rather than failing the author's whole publish.
          computeOutputs: (inputs: { operation?: string; target?: string }) => {
            if (inputs.operation === 'send') {
              const base = {
                messageId: {
                  toJSON: () => ({ type: 'string', _metadata: { label: 'Message ID' } }),
                },
                sentAt: { toJSON: () => ({ type: 'string', _metadata: { label: 'Sent at' } }) },
              }
              // Conditional on a second input — invisible unless the extractor
              // varies `target`.
              if (inputs.target === 'channel') {
                return {
                  ...base,
                  channelId: { toJSON: () => ({ type: 'string', _metadata: {} }) },
                }
              }
              if (inputs.target === 'user') {
                return { ...base, userId: { toJSON: () => ({ type: 'string', _metadata: {} }) } }
              }
              return base
            }
            if (inputs.operation === 'react') {
              return {
                reactionId: {
                  toJSON: () => ({ type: 'string', _metadata: { label: 'Reaction ID' } }),
                },
              }
            }
            throw new Error('computeOutputs blew up for this selection')
          },
        },
        toolMap: {
          'message.send': 'send_message',
          'message.react': 'send_message',
          'message.explode': 'send_message',
        },
        config: {
          requiresConnection: true,
          canRunSingle: false,
        },
        execute: async () => ({}),
      },
      {
        // Declares neither `config` nor `schema.outputs` — the shape every
        // pre-projection catalog has. Must NOT gain the optional keys.
        id: 'bare',
        label: 'Bare',
        schema: { inputs: {} },
        toolMap: { 'thing.do': 'send_message' },
        execute: async () => ({}),
      },
    ],
    triggers: [
      {
        id: 'on_message_received',
        label: 'Message received',
        description: 'Fires when a new message arrives.',
        schema: {
          inputs: {
            channelId: {
              toJSON: () => ({ type: 'string', _metadata: { label: 'Channel' } }),
            },
          },
          outputs: {
            resourceId: {
              toJSON: () => ({ type: 'string', _metadata: { label: 'Resource id' } }),
            },
            topic: {
              toJSON: () => ({ type: 'string', _metadata: { label: 'Topic' } }),
            },
          },
        },
        execute: async () => ({}),
        workflow: {},
        agent: {
          label: 'Message received',
          description: 'New message arrived in a channel.',
          defaultEnabled: true,
        },
      },
    ],
  },
  // Imported via `@auxx/sdk/fields` (not inlined) so catalog extraction
  // exercises the real `defineFields` runtime — guards the esbuild resolver
  // mapping for `@auxx/sdk/fields` (see compile-and-extract-catalog.ts).
  fields: defineFields([
    {
      appFieldKey: 'customerId',
      type: 'TEXT',
      targetEntity: 'contact',
      scope: 'connection',
      name: 'Customer ID',
      capabilities: { hidden: true, updatable: false },
    },
    {
      appFieldKey: 'tier',
      type: 'SINGLE_SELECT',
      targetEntity: 'contact',
      scope: 'installation',
      name: 'Tier',
      options: [
        { value: 'gold', label: 'Gold' },
        { value: 'silver', label: 'Silver' },
      ],
    },
  ]),
}
