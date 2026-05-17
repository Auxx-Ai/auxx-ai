// packages/lib/src/ai/kopilot/prompts/__tests__/build-kopilot-prompt.test.ts

import { describe, expect, it } from 'vitest'
import type { ResolvedAgentConfig } from '../../../../agents'
import {
  fixtureCapabilities,
  fixtureCurrentUser,
  fixtureDomainState,
  fixtureEntityCatalog,
  fixtureIntegrations,
  fixtureTools,
  fixtureToolsetAdditions,
} from '../__test-fixtures'
import { buildKopilotPrompt } from '../build-kopilot-prompt'
import type { TriggerContext } from '../trigger-context'

const baseArgs = {
  domainState: fixtureDomainState,
  entityCatalog: fixtureEntityCatalog,
  capabilities: fixtureCapabilities,
  tools: fixtureTools,
  currentUser: fixtureCurrentUser,
  integrations: fixtureIntegrations,
  toolsetPromptAdditions: fixtureToolsetAdditions,
}

const masterAgentConfig: ResolvedAgentConfig = {
  agentId: null,
  userId: null,
  name: 'Kopilot',
  description: null,
  prompt: { type: 'doc', content: [] },
} as unknown as ResolvedAgentConfig

const userAgentConfig: ResolvedAgentConfig = {
  agentId: 'agent_1',
  userId: 'bot-7',
  name: 'Triage Bot',
  description: 'Watches refund threads and tags them.',
  prompt: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'When mentioned on a thread, read the last message. If it mentions refund/return/money back, add the `refund` tag and assign to billing@auxx.',
          },
        ],
      },
    ],
  },
} as unknown as ResolvedAgentConfig

describe('buildKopilotPrompt', () => {
  it('chat mode renders master persona ahead of core', () => {
    const out = buildKopilotPrompt({ ...baseArgs })
    expect(out).toMatch(/You are Kopilot[\s\S]*## Context/)
  })

  it('chat mode includes the capabilities list', () => {
    const out = buildKopilotPrompt({ ...baseArgs })
    expect(out).toContain('## What you can help with')
    expect(out).toContain('- Replying to tickets')
  })

  it('agent mode renders user-authored persona, no master persona', () => {
    const out = buildKopilotPrompt({ ...baseArgs, agentConfig: userAgentConfig })
    expect(out).toContain('You are Triage Bot. Watches refund threads')
    expect(out).not.toContain('You are Kopilot, an AI assistant')
    expect(out).not.toContain('## Stay on task')
  })

  it('trigger context renders only on autonomous runs', () => {
    const trigger: TriggerContext = {
      kind: 'mention',
      instructions: null,
      payload: { firedAt: '2026-05-16T10:22:00Z' },
    }
    const out = buildKopilotPrompt({
      ...baseArgs,
      agentConfig: userAgentConfig,
      triggerContext: trigger,
    })
    expect(out).toContain('## Trigger fired')
    expect(out).toContain('## Run mode')
    expect(out).toContain('## Acting as')

    const chatOut = buildKopilotPrompt({ ...baseArgs, agentConfig: userAgentConfig })
    expect(chatOut).not.toContain('## Trigger fired')
  })

  it('throws when triggerContext is set without a user-authored agent', () => {
    const trigger: TriggerContext = {
      kind: 'mention',
      instructions: null,
      payload: {},
    }
    expect(() => buildKopilotPrompt({ ...baseArgs, triggerContext: trigger })).toThrow(
      /triggerContext set without/
    )
    expect(() =>
      buildKopilotPrompt({ ...baseArgs, agentConfig: masterAgentConfig, triggerContext: trigger })
    ).toThrow(/triggerContext set without/)
  })

  it('master persona accepts master-sentinel agentConfig', () => {
    const out = buildKopilotPrompt({ ...baseArgs, agentConfig: masterAgentConfig })
    expect(out).toContain('You are Kopilot, an AI assistant')
  })

  it('house rules render for every agent and outrank persona by recency', () => {
    const master = buildKopilotPrompt({ ...baseArgs })
    const userAgent = buildKopilotPrompt({ ...baseArgs, agentConfig: userAgentConfig })
    expect(master).toContain('## House rules')
    expect(userAgent).toContain('## House rules')

    // House rules sit at the end of tier 1, immediately before persona content
    // (master capabilities for master, agent prompt for user-authored).
    expect(master.indexOf('## House rules')).toBeLessThan(
      master.indexOf('## What you can help with')
    )
    expect(userAgent.indexOf('## House rules')).toBeLessThan(userAgent.indexOf('Triage Bot'))
  })

  it('master capabilities only render for master persona', () => {
    expect(buildKopilotPrompt({ ...baseArgs })).toContain('## What you can help with')
    expect(buildKopilotPrompt({ ...baseArgs, agentConfig: userAgentConfig })).not.toContain(
      '## What you can help with'
    )
  })

  it('master persona no longer renders inline Stay on task (moved to house rules)', () => {
    const out = buildKopilotPrompt({ ...baseArgs })
    expect(out).not.toContain('## Stay on task')
  })

  it('autonomous run renders trigger blocks in tier order', () => {
    const trigger = {
      kind: 'mention' as const,
      instructions: 'Tag the thread `refund`.',
      payload: {
        firedAt: '2026-05-16T10:22:00Z',
        commentId: 'cm:1',
        parentRecordId: 'thread:abc',
      },
    }
    const out = buildKopilotPrompt({
      ...baseArgs,
      agentConfig: userAgentConfig,
      triggerContext: trigger,
    })
    // run-mode-banner is tier 1 (static) so appears very early
    // trigger-instructions / trigger-acting-as are tier 2
    // trigger-fired (per-turn payload) is tier 3 (last)
    expect(out.indexOf('## Run mode')).toBeLessThan(out.indexOf('## Trigger instructions'))
    expect(out.indexOf('## Trigger instructions')).toBeLessThan(out.indexOf('## Acting as'))
    expect(out.indexOf('## Acting as')).toBeLessThan(out.indexOf('## Trigger fired'))
  })
})
