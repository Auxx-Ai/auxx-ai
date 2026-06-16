// packages/lib/src/ai/kopilot/prompts/sections/__tests__/chat-formatting.test.ts

import { describe, expect, it } from 'vitest'
import { makeCtx } from '../__test-helpers'
import { chatFormatting } from '../chat-formatting'
import { SYSTEM_PROMPT_SECTIONS } from '../registry'
import { renderSections } from '../render'

describe('chatFormatting', () => {
  it('declares the plain-text rule on the chat surface', () => {
    const out = chatFormatting.render(makeCtx({ runMode: 'interactive', surface: 'chat' }))
    expect(out).toContain('plain text')
    expect(out).toContain('does not render markdown')
  })

  it('is gated to the chat surface only', () => {
    expect(chatFormatting.surfaces?.has('chat')).toBe(true)
    expect(chatFormatting.surfaces?.has('builder')).toBe(false)
    expect(chatFormatting.surfaces?.has('email')).toBe(false)
  })
})

// Production live chat (`build-chat-engine-config.ts`) and the chat-channel eval
// (`buildEffectiveAgentRuntime` deriving from a `customer_message`/`chat`
// trigger) both resolve to surface `chat` + audience `customer` +
// runMode `interactive`. Assert that profile renders the plain-text rule and
// drops every in-app formatting section, so what evals grade is what chat runs.
describe('chat customer profile (prod ↔ sim parity)', () => {
  const prompt = renderSections(
    SYSTEM_PROMPT_SECTIONS,
    makeCtx({ runMode: 'interactive', surface: 'chat', audience: 'customer' })
  )

  it('includes the chat plain-text formatting rule', () => {
    expect(prompt).toContain('Respond in plain text')
  })

  it('drops the builder-only rich-block catalog', () => {
    expect(prompt).not.toContain('## Rich Blocks')
    expect(prompt).not.toContain('auxx:entity-list')
  })

  it('drops the builder-only caller preamble link syntax', () => {
    expect(prompt).not.toContain('auxx://actor/')
  })

  it('uses customer-facing instructions with tool-failure opacity', () => {
    expect(prompt).toContain('reply to the customer')
    expect(prompt).toContain('do not tell the customer a tool/integration failed')
  })
})
