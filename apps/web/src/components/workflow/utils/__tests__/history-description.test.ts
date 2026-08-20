// apps/web/src/components/workflow/utils/__tests__/history-description.test.ts
//
// What a history row says about the node it acted on. Two of the three
// derivations here are only possible against the graph the entry is recorded
// ON TOP OF, which is why `describeHistoryEntry` takes a baseline:
//
//   - a delete has to name a node the new graph no longer contains
//   - a rename is a title diff, and the call site cannot supply one because
//     `setInputs` hands over a whole data object

import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../../store/types'
import type { FlowNode } from '../../types'
import { describeHistoryEntry } from '../history-description'

function node(id: string, title?: string, type = 'ai'): FlowNode {
  return { id, position: { x: 0, y: 0 }, data: { title, type } } as unknown as FlowNode
}

function baselineOf(nodes: FlowNode[]): HistoryEntry {
  return {
    id: 'baseline',
    timestamp: 0,
    action: 'workflow_event',
    store: 'workflow',
    data: { event: 'NodeChange', nodes, edges: [] },
  }
}

describe('describeHistoryEntry — naming the subject', () => {
  it('names the node and carries its type for the badge icon', () => {
    const result = describeHistoryEntry(
      { verb: 'added', fallbackLabel: 'Node added', nodeId: 'n1', nodes: [node('n1', 'Output')] },
      undefined
    )

    expect(result.subject).toEqual({ id: 'n1', title: 'Output', nodeType: 'ai' })
    expect(result.verb).toBe('added')
    expect(result.label).toBe('Output added')
  })

  it('names a DELETED node from the baseline, since the new graph has lost it', () => {
    const result = describeHistoryEntry(
      { verb: 'deleted', fallbackLabel: 'Node deleted', nodeId: 'n1', nodes: [] },
      baselineOf([node('n1', 'Output')])
    )

    expect(result.subject?.title).toBe('Output')
    expect(result.label).toBe('Output deleted')
  })

  it('falls back to the plain sentence for an untitled node', () => {
    const result = describeHistoryEntry(
      { verb: 'added', fallbackLabel: 'Node added', nodeId: 'n1', nodes: [node('n1')] },
      undefined
    )

    expect(result.subject).toBeUndefined()
    expect(result.label).toBe('Node added')
  })

  it('falls back for events with no node subject at all', () => {
    const result = describeHistoryEntry({ fallbackLabel: 'Edge added', nodes: [] }, undefined)

    expect(result.subject).toBeUndefined()
    expect(result.label).toBe('Edge added')
  })

  it('counts instead of naming when more than one node moved', () => {
    const result = describeHistoryEntry(
      { verb: 'pasted', fallbackLabel: 'Node pasted', count: 3, nodes: [] },
      undefined
    )

    expect(result.subject).toBeUndefined()
    expect(result.label).toBe('3 nodes pasted')
  })

  it('names the node when the count is exactly one', () => {
    const result = describeHistoryEntry(
      {
        verb: 'moved',
        fallbackLabel: 'Node position changed',
        nodeId: 'n1',
        count: 1,
        nodes: [node('n1', 'Output')],
      },
      undefined
    )

    expect(result.label).toBe('Output moved')
  })
})

describe('describeHistoryEntry — rename', () => {
  it('reports a changed title as a rename, with both names', () => {
    const result = describeHistoryEntry(
      {
        verb: 'changed',
        fallbackLabel: 'Node changed',
        nodeId: 'n1',
        detectRename: true,
        nodes: [node('n1', 'Output')],
      },
      baselineOf([node('n1', 'Node 1')])
    )

    expect(result.verb).toBe('renamed to')
    expect(result.subject?.title).toBe('Node 1') // the name it had…
    expect(result.renamedTo).toBe('Output') // …and the one it got
    expect(result.label).toBe('Node 1 renamed to Output')
  })

  it('is a plain change when some other field moved', () => {
    const before = node('n1', 'Output')
    const after = { ...node('n1', 'Output'), data: { title: 'Output', type: 'ai', prompt: 'hi' } }

    const result = describeHistoryEntry(
      {
        verb: 'changed',
        fallbackLabel: 'Node changed',
        nodeId: 'n1',
        detectRename: true,
        nodes: [after as FlowNode],
      },
      baselineOf([before])
    )

    expect(result.renamedTo).toBeUndefined()
    expect(result.label).toBe('Output changed')
  })

  it('never claims a rename for an event that is not a data change', () => {
    // A drag carries no `detectRename`, so even a title that differs between
    // snapshots (it cannot, but the guard is what makes that true) reads as a move.
    const result = describeHistoryEntry(
      {
        verb: 'moved',
        fallbackLabel: 'Node position changed',
        nodeId: 'n1',
        nodes: [node('n1', 'Output')],
      },
      baselineOf([node('n1', 'Node 1')])
    )

    expect(result.verb).toBe('moved')
    expect(result.renamedTo).toBeUndefined()
  })

  it('does not claim a rename when the node is newly added', () => {
    const result = describeHistoryEntry(
      {
        verb: 'changed',
        fallbackLabel: 'Node changed',
        nodeId: 'n1',
        detectRename: true,
        nodes: [node('n1', 'Output')],
      },
      baselineOf([]) // node did not exist before
    )

    expect(result.renamedTo).toBeUndefined()
    expect(result.label).toBe('Output changed')
  })
})
