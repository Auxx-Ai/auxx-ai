// packages/lib/src/ai/kopilot/prompts/sections/__tests__/workflow-builder.test.ts

import { describe, expect, it } from 'vitest'
import { buildWorkflowBuilderPromptSection } from '../workflow-builder'

describe('buildWorkflowBuilderPromptSection', () => {
  it('requires the structured workflow completion shape and partial progress', () => {
    const prompt = buildWorkflowBuilderPromptSection()

    expect(prompt).toContain('`Done`')
    expect(prompt).toContain('`Still needs your input`')
    expect(prompt).toContain('`Remaining validation`')
    expect(prompt).toContain('Apply every safe, unambiguous part before asking')
  })
})
