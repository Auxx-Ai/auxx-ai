// apps/web/src/components/workflow/hooks/__tests__/workflow-history-events.test.ts
//
// `WorkflowHistoryEvent` must not make a claim the builder cannot keep. It drifted
// badly once: seventeen members, seven of which nothing ever dispatched — and two
// of those seven (`NodeDragStop`, `LayoutOrganize`) named actions that were
// recorded NOWHERE, so moving a node and running auto-layout were silently not
// undoable. The other five were duplicate labels for an action already recorded
// under a coarser name.
//
// These two tests pin both directions, so a member added to the enum and nowhere
// else fails immediately instead of quietly becoming the eighth.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getHistoryLabel, WorkflowHistoryEvent } from '../use-save-to-history'

const WORKFLOW_SRC = join(__dirname, '../..')

/**
 * The whole builder, not a hand-kept list of files — a list goes stale exactly
 * when someone moves a dispatch, which is when this test needs to be right.
 */
function readWorkflowSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name)
    if (item.isDirectory()) return item.name === '__tests__' ? [] : readWorkflowSources(path)
    if (!/\.tsx?$/.test(item.name) || item.name === 'use-save-to-history.ts') return []
    return [readFileSync(path, 'utf8')]
  })
}

const DISPATCH_SITES = readWorkflowSources(WORKFLOW_SRC)

describe('WorkflowHistoryEvent', () => {
  it('gives every member a real label', () => {
    for (const event of Object.values(WorkflowHistoryEvent)) {
      const label = getHistoryLabel(event)
      expect(label, `${event} has no label`).toBeTruthy()
      expect(label, `${event} fell through to the default`).not.toBe('Unknown Event')
    }
  })

  it('dispatches every member', () => {
    const undispatched = Object.values(WorkflowHistoryEvent).filter(
      (event) => !DISPATCH_SITES.some((src) => src.includes(`WorkflowHistoryEvent.${event}`))
    )

    expect(
      undispatched,
      `these members name actions nothing records, so they are not undoable: ${undispatched.join(', ')}`
    ).toEqual([])
  })
})
