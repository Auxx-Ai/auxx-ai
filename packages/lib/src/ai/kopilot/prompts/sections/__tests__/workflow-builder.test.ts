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

  it('teaches the app-block surface: discovery, operation-first, connections', () => {
    const prompt = buildWorkflowBuilderPromptSection()

    // Discovery — the live run's failure was the agent concluding an installed
    // block did not exist because `list_node_types` did not list it.
    expect(prompt).toContain('`list_app_blocks`')
    expect(prompt).toContain('NOT in `list_node_types`')
    expect(prompt).toContain('`<appId>:<blockId>`')
    // Operation first, or the block resolves no outputs at all.
    expect(prompt).toContain('set `resource` and `operation` FIRST')
    expect(prompt).toContain('resolves NO outputs')
    // Unbound is the healthy default (§0 S1).
    expect(prompt).toContain('leave `connectionId` unset')
  })

  it('forbids auxx:// deep links for workflow nodes', () => {
    // Live-run finding: node ids are shaped like record ids, so the model
    // linked them and the chat rendered every one as "Unknown".
    const prompt = buildWorkflowBuilderPromptSection()

    expect(prompt).toContain('Workflow nodes are not CRM records')
    expect(prompt).toContain('auxx://record/<nodeId>')
  })

  it('stays static — no per-org content leaks into the cached section', () => {
    // The section is cached as one static block; naming an org's apps here
    // would drop it out of that block on every turn.
    expect(buildWorkflowBuilderPromptSection()).toBe(buildWorkflowBuilderPromptSection())
  })
})
