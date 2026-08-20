// apps/web/src/components/workflow/canvas/__tests__/rehydrate-seams.test.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripComments, WORKFLOW_ROOT } from '../../parity/monorepo-paths'

/**
 * Two one-line regressions the canvas can silently re-acquire, both of which
 * cost a plan to find and neither of which any behavioural test can see without
 * a mounted React Flow provider, a real store tree and a synthesized gesture.
 * Same rationale as `parity/store-subscription-scrape.test.ts`, which the repo
 * already accepts: the property is about SOURCE SHAPE.
 *
 * The merge itself is tested for real in
 * `utils/__tests__/interaction-state.test.ts` — this only pins that the seam
 * still goes through it.
 */

const canvasSource = () =>
  stripComments(readFileSync(join(WORKFLOW_ROOT, 'canvas/workflow-canvas.tsx'), 'utf8'))

describe('workflow:externalUpdate must MERGE, not replace', () => {
  it('routes the incoming nodes through mergeInteractionState', () => {
    const source = canvasSource()

    expect(source).toContain('mergeInteractionState')
    expect(source).toMatch(/setNodes\(\(prevNodes\) => mergeInteractionState\(/)
  })

  it('never pushes a fetched node array straight into React Flow', () => {
    // `setNodes(payload.nodes)` wholesale is the shape that (a) let a persisted
    // `selected` jump the user's panel to a node they were not looking at and
    // (b) — once the write seam strips selection — deselects everything on
    // every agent edit.
    expect(canvasSource()).not.toMatch(/setNodes\(\s*(payload\.nodes|incoming)\s*\)/)
  })
})

describe('the viewport is a browser preference, not part of the document', () => {
  it('writes localStorage instead of queueing a draft save', () => {
    const source = canvasSource()

    expect(source).toContain('writeStoredViewport')
    // A pan queueing a write is what made an idle second tab able to 409 an
    // editing one (plan 22 §5 D1).
    expect(source).not.toContain('debouncedSave')
  })
})
