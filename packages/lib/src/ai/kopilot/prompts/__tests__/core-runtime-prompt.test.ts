// packages/lib/src/ai/kopilot/prompts/__tests__/core-runtime-prompt.test.ts

import type { ActorId } from '@auxx/types/actor'
import { describe, expect, it } from 'vitest'
import type { KopilotDomainState } from '../../types'
import { buildCoreRuntimePrompt } from '../core-runtime-prompt'

const baseDomainState: KopilotDomainState = {
  context: { page: 'mail' },
}

const baseArgs = {
  domainState: baseDomainState,
  entityCatalog: [],
  tools: [],
  currentUser: null,
  integrations: [],
  toolsetPromptAdditions: '',
}

describe('buildCoreRuntimePrompt — autonomous mode', () => {
  it('omits the block catalog and rich-block schemas', () => {
    const out = buildCoreRuntimePrompt({ ...baseArgs, runMode: 'autonomous' })
    expect(out).not.toContain('## Rich Blocks')
    expect(out).not.toContain('auxx:entity-card')
    expect(out).not.toContain('auxx:entity-list')
    expect(out).not.toContain('auxx:plan-steps')
  })

  it('omits the Rich Blocks section', () => {
    const out = buildCoreRuntimePrompt({ ...baseArgs, runMode: 'autonomous' })
    expect(out).not.toContain('## Rich Blocks')
  })

  it('omits the Approval-protected tools section', () => {
    const out = buildCoreRuntimePrompt({ ...baseArgs, runMode: 'autonomous' })
    expect(out).not.toContain('## Approval-protected tools')
  })

  it("omits the Who you're helping caller preamble", () => {
    const out = buildCoreRuntimePrompt({
      ...baseArgs,
      runMode: 'autonomous',
      currentUser: {
        userId: 'u_1',
        actorId: 'user:u_1' as ActorId,
        name: 'Markus',
        email: 'm@example.com',
        role: 'owner',
      },
    })
    expect(out).not.toContain("## Who you're helping")
    expect(out).not.toContain('**caller**')
  })

  it('uses the audit-trail job statement, not the chat one', () => {
    const out = buildCoreRuntimePrompt({ ...baseArgs, runMode: 'autonomous' })
    expect(out).toContain('audit trail')
    expect(out).not.toContain('rich UI blocks')
  })

  it('autonomous instructions do not invite auxx:* fences or address a caller', () => {
    const out = buildCoreRuntimePrompt({ ...baseArgs, runMode: 'autonomous' })
    const instructionsSlice = out.slice(out.indexOf('## Instructions'))
    expect(instructionsSlice).not.toContain('auxx:*')
    expect(instructionsSlice).not.toContain('embed')
    expect(instructionsSlice).not.toContain('the caller')
    // The instructions tell the model NOT to emit fenced code blocks — that
    // phrase is expected to appear, but only as a prohibition.
    expect(instructionsSlice).toContain('Do not emit fenced code blocks')
  })

  it('autonomous integration fallback does not say "tell the user"', () => {
    const out = buildCoreRuntimePrompt({ ...baseArgs, runMode: 'autonomous' })
    expect(out).toContain('## Available Integrations')
    expect(out).not.toContain('Tell the user to connect one')
    expect(out).toContain('note the missing integration in your summary')
  })
})

describe('buildCoreRuntimePrompt — interactive mode', () => {
  it('includes the block catalog and approval section', () => {
    const out = buildCoreRuntimePrompt({ ...baseArgs, runMode: 'interactive' })
    expect(out).toContain('## Rich Blocks')
    expect(out).toContain('## Approval-protected tools')
  })

  it('renders the caller preamble when currentUser is provided', () => {
    const out = buildCoreRuntimePrompt({
      ...baseArgs,
      runMode: 'interactive',
      currentUser: {
        userId: 'u_1',
        actorId: 'user:u_1' as ActorId,
        name: 'Markus',
        email: 'm@example.com',
        role: 'owner',
      },
    })
    expect(out).toContain("## Who you're helping")
    expect(out).toContain('Markus')
    expect(out).toContain('**caller**')
  })

  it('uses the chat job statement', () => {
    const out = buildCoreRuntimePrompt({ ...baseArgs, runMode: 'interactive' })
    expect(out).toContain('rich UI blocks')
  })
})
