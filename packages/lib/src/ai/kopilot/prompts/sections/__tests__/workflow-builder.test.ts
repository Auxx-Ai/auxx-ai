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
    // Unbound is the healthy default (§0 S1), and binding is the exception.
    expect(prompt).toContain('leave `connectionId` unset')
    expect(prompt).toContain('`list_app_connections`')
    expect(prompt).toContain('Personal connections are never listed or bindable')
  })

  it('rules out rewording a no-match `list_app_blocks` query', () => {
    // Live-run failure: 33 `list_app_blocks` calls with reworded queries until
    // the iteration cap ended the turn. The empty result is an answer, and
    // `notInstalled` is where the turn goes next.
    const prompt = buildWorkflowBuilderPromptSection()

    expect(prompt).toContain('do NOT call it again with a reworded query')
    expect(prompt).toContain('the answer will not change')
    expect(prompt).toContain('`notInstalled`')
    expect(prompt).toContain('emit an `auxx:app-install` block')
    expect(prompt).toContain('say plainly that no app provides that capability')
  })

  it('forbids every record primitive for workflow nodes, not just the link', () => {
    // Live-run finding: node ids are shaped like record ids. Banning only the
    // `auxx://` link moved the model to the entity fences, which render the
    // node id as "Record unavailable" — so all three primitives are named.
    const prompt = buildWorkflowBuilderPromptSection()

    expect(prompt).toContain('Workflow nodes are not CRM records')
    expect(prompt).toContain('PLAIN TEXT')
    expect(prompt).toContain('auxx://record/<nodeId>')
    expect(prompt).toContain('`auxx:entity-card` fence')
    expect(prompt).toContain('`auxx:entity-list` fence')
    expect(prompt).toContain('take CRM record ids ONLY')
  })

  it('forbids empty entity fences for non-record tool output', () => {
    // The same run emitted `auxx:entity-list {"recordIds":[]}` after
    // `list_app_blocks` / `list_app_connections`, rendering as "Records 0".
    const prompt = buildWorkflowBuilderPromptSection()

    expect(prompt).toContain('never an EMPTY one')
    expect(prompt).toContain('{"recordIds": []}')
  })

  it('teaches branch IDS, not the unstable derived names', () => {
    // The old paragraph taught branch NAMES and used `branch: "High"` — a
    // text-classifier-shaped name an if-else can never produce. Its names are
    // derived from array position, so `IF` becomes `CASE 1` the moment a second
    // case is authored, and the branch vocabulary the agent was handed one
    // iteration earlier no longer exists (plan 21 §3.2/§12.2).
    const prompt = buildWorkflowBuilderPromptSection()

    expect(prompt).toContain('Address a branch by its **id**')
    expect(prompt).toContain('the branch id IS the `case_id` you authored')
    expect(prompt).toContain('same batch')
    expect(prompt).toContain('`connectedTo`')
    expect(prompt).toContain('`false` is the reserved ELSE handle')
    // The doctrine that steered the model off the only stable address it has.
    expect(prompt).not.toContain('never invent handle ids')
    expect(prompt).not.toContain('branch: "High"')
    // The honesty rules it must NOT have taken down with it.
    expect(prompt).toContain('Never invent an output name')
    expect(prompt).toContain('Never invent node ids, output names, template ids, or node types')
  })

  it('stays static — no per-org content leaks into the cached section', () => {
    // The section is cached as one static block; naming an org's apps here
    // would drop it out of that block on every turn.
    expect(buildWorkflowBuilderPromptSection()).toBe(buildWorkflowBuilderPromptSection())
  })
})
