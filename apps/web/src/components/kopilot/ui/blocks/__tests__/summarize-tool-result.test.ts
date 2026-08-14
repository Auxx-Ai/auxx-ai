// apps/web/src/components/kopilot/ui/blocks/__tests__/summarize-tool-result.test.ts

import { describe, expect, it } from 'vitest'
import { summarizeToolResult } from '../summarize-tool-result'

describe('summarizeToolResult workflow digests', () => {
  it('summarizes discovery counts', () => {
    expect(
      summarizeToolResult('list_node_types', null, {
        label: 'Node types listed',
        resultCount: 1,
      }).summary
    ).toBe('1 node type listed')
    expect(
      summarizeToolResult('find_workflow_templates', null, {
        label: 'Workflow templates found',
        resultCount: 3,
      }).summary
    ).toBe('3 templates found')
  })

  it('summarizes workflow reads and validation findings', () => {
    expect(
      summarizeToolResult('get_workflow', null, {
        label: 'Workflow loaded',
        nodeCount: 4,
      }).summary
    ).toBe('4 nodes')
    expect(
      summarizeToolResult('validate_workflow', null, {
        label: 'Workflow validated',
        errorCount: 1,
        warningCount: 2,
      }).summary
    ).toBe('1 error · 2 warnings')
    expect(
      summarizeToolResult('validate_workflow', null, {
        label: 'Workflow validated',
        errorCount: 0,
        warningCount: 0,
      }).summary
    ).toBe('No issues')
  })
})
