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
          },
          outputs: {},
        },
        toolMap: {
          'message.send': 'send_message',
        },
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
          outputs: {},
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
}
