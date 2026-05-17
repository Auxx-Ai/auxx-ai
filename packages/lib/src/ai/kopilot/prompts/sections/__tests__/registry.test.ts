// packages/lib/src/ai/kopilot/prompts/sections/__tests__/registry.test.ts

import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT_SECTIONS, validateStabilityOrder } from '../registry'
import type { PromptSection } from '../types'
import { ALL_MODES } from '../types'

describe('validateStabilityOrder', () => {
  it('passes on the live registry', () => {
    expect(() => validateStabilityOrder()).not.toThrow()
  })

  it('passes on a correctly-ordered list', () => {
    const ok: PromptSection[] = [
      { id: 'a', modes: ALL_MODES, stability: 'static', render: () => null },
      { id: 'b', modes: ALL_MODES, stability: 'org', render: () => null },
      { id: 'c', modes: ALL_MODES, stability: 'turn', render: () => null },
    ]
    expect(() => validateStabilityOrder(ok)).not.toThrow()
  })

  it('throws when a static section follows an org section', () => {
    const bad: PromptSection[] = [
      { id: 'a', modes: ALL_MODES, stability: 'org', render: () => null },
      { id: 'b', modes: ALL_MODES, stability: 'static', render: () => null },
    ]
    expect(() => validateStabilityOrder(bad)).toThrow(/out of stability order/)
  })

  it('throws when an org section follows a turn section', () => {
    const bad: PromptSection[] = [
      { id: 'a', modes: ALL_MODES, stability: 'turn', render: () => null },
      { id: 'b', modes: ALL_MODES, stability: 'org', render: () => null },
    ]
    expect(() => validateStabilityOrder(bad)).toThrow(/out of stability order/)
  })
})

describe('SYSTEM_PROMPT_SECTIONS', () => {
  it('has unique section ids', () => {
    const ids = SYSTEM_PROMPT_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
