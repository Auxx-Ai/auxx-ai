// packages/lib/src/ai/kopilot/prompts/__test-fixtures.ts

import type { ActorId } from '@auxx/types/actor'
import type { IntegrationCatalogEntry } from '../../../cache/integration-catalog'
import type { AgentToolDefinition } from '../../agent-framework/types'
import type { KopilotDomainState } from '../types'
import type { CurrentUserInfo, EntityCatalogEntry } from './shared-types'

/**
 * Shared test fixture. Reused by section unit tests and full-prompt snapshot
 * tests to keep all assertions referring to the same context.
 */

export const fixtureDomainState: KopilotDomainState = {
  context: {
    page: '/thread/abc123',
    references: [
      {
        kind: 'thread',
        id: 'thread:abc123',
        label: 'Refund request from Carolin',
        origin: 'surface',
      },
      { kind: 'record', id: 'contact:99', label: 'Carolin Klooth', origin: 'mention' },
    ],
  },
}

export const fixtureEntityCatalog: EntityCatalogEntry[] = [
  { apiSlug: 'contacts', label: 'Contact', plural: 'contacts', entityDefinitionId: 'def_contacts' },
  {
    apiSlug: 'companies',
    label: 'Company',
    plural: 'companies',
    entityDefinitionId: 'def_companies',
  },
]

export const fixtureIntegrations: IntegrationCatalogEntry[] = [
  {
    integrationId: 'integ:gmail-1',
    displayName: 'Gmail (markus@…)',
    platform: 'gmail',
    channel: 'email',
    recipientModel: 'email',
    newOutbound: true,
    threadReply: true,
    subject: true,
    ccBcc: true,
    drafts: true,
    attachments: true,
  } as IntegrationCatalogEntry,
]

export const fixtureCurrentUser: CurrentUserInfo = {
  userId: 'u_42',
  actorId: 'user:u_42' as ActorId,
  name: 'Markus',
  email: 'markus@auxx-lift.com',
  role: 'admin',
}

export const fixtureTools: AgentToolDefinition[] = [
  {
    name: 'search_entities',
    displayName: 'Search entities',
    description: 'Search CRM records.',
    parameters: {},
    execute: async () => ({ ok: true, value: null }) as never,
    usageNotes: 'Returns up to 25 matches. Pass `apiSlug` to scope.',
  } as AgentToolDefinition,
  {
    name: 'reply_to_thread',
    displayName: 'Reply to thread',
    description: 'Reply to a thread.',
    parameters: {},
    execute: async () => ({ ok: true, value: null }) as never,
    usageNotes: 'Approval-gated. Pass `threadId` and `body`.',
  } as AgentToolDefinition,
  {
    name: 'list_members',
    displayName: 'List members',
    description: 'List workspace members.',
    parameters: {},
    execute: async () => ({ ok: true, value: null }) as never,
  } as AgentToolDefinition,
  {
    name: 'list_drafts',
    displayName: 'List drafts',
    description: 'List drafts.',
    parameters: {},
    execute: async () => ({ ok: true, value: null }) as never,
  } as AgentToolDefinition,
]

export const fixtureToolsetAdditions =
  '## Hard rules from mail toolset\n- Always check the active thread before replying.'

export const fixtureCapabilities = [
  'Replying to tickets',
  'Searching contacts and companies',
  'Drafting emails',
]
