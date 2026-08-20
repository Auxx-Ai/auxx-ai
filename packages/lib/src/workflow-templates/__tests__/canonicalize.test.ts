// packages/lib/src/workflow-templates/__tests__/canonicalize.test.ts
//
// `WorkflowTemplate.graph` is one of the five graph storage locations (plan 23
// §3.4) and was the last one with no opinion about what it may contain. Its
// read boundary — `resolveTemplateById` — hydrates, the admin editor renders
// THAT into its JSON textarea, and Save posts the textarea straight back. So
// without a write-side canonicalizer, opening a clean template and pressing
// Save was enough to store derived state as if an author had written it, and
// "Export to file" turned the same blob into a committable `*.template.json`.

import { describe, expect, it } from 'vitest'
import { type GraphDocument, hydrateGraph } from '../../workflow-engine/catalog/graph-hydration'
import { HYDRATION_OPTIONS } from '../../workflow-engine/catalog/hydration-policy'
import { canonicalizeTemplateGraph } from '../canonicalize'

/** A canonical stored template graph: authored config only. */
const canonical = {
  nodes: [
    {
      id: 'webhook-1',
      position: { x: 0, y: 0 },
      data: { type: 'webhook', title: 'Webhook', method: 'POST' },
    },
    {
      id: 'end-1',
      position: { x: 300, y: 0 },
      data: { type: 'end', title: 'End', status: 'success' },
    },
  ],
  // No handles: the defaults are stripped on write and restored on read.
  edges: [{ id: 'e1', source: 'webhook-1', target: 'end-1' }],
} as unknown as GraphDocument

describe('canonicalizeTemplateGraph', () => {
  it('undoes exactly what the read boundary added — the editor round trip', () => {
    // What the admin editor is handed, and therefore what Save posts back.
    const asTheEditorSeesIt = hydrateGraph(canonical, HYDRATION_OPTIONS)

    expect(canonicalizeTemplateGraph(asTheEditorSeesIt)).toEqual(canonical)
  })

  it('is a no-op on a graph that is already canonical', () => {
    // Idempotence is what makes it safe to run at every writer unconditionally,
    // including on rows written before it existed.
    expect(canonicalizeTemplateGraph(canonical)).toEqual(canonical)
    expect(canonicalizeTemplateGraph(canonicalizeTemplateGraph(canonical))).toEqual(canonical)
  })

  it('strips the canvas state a builder export carries', () => {
    // The §1 complaint in file form: a super-admin pastes a graph copied out of
    // the builder. `selected: true` is not inert — React Flow replays it from a
    // mount effect, which opens a panel and re-centres the canvas.
    const builderExport = {
      nodes: [
        {
          id: 'webhook-1',
          type: 'standard',
          position: { x: 0, y: 0 },
          selected: true,
          dragging: false,
          width: 320,
          height: 96,
          data: {
            type: 'webhook',
            title: 'Webhook',
            method: 'POST',
            id: 'webhook-1',
            isValid: true,
            errors: [],
          },
        },
      ],
      edges: [],
    } as unknown as GraphDocument

    const stored = canonicalizeTemplateGraph(builderExport) as {
      nodes: {
        type?: unknown
        selected?: unknown
        width?: unknown
        data: Record<string, unknown>
      }[]
    }

    expect(stored.nodes[0]).not.toHaveProperty('selected')
    expect(stored.nodes[0]).not.toHaveProperty('dragging')
    expect(stored.nodes[0]).not.toHaveProperty('type')
    expect(stored.nodes[0]?.data).not.toHaveProperty('isValid')
    expect(stored.nodes[0]?.data).not.toHaveProperty('errors')
    expect(stored.nodes[0]?.data).not.toHaveProperty('id')
    // ...while the authored config survives untouched. `width`/`height` are
    // authored too — `handleNodeResize` writes a container size a user chose —
    // so they are deliberately KEPT, not canvas state.
    expect(stored.nodes[0]?.data).toMatchObject({ type: 'webhook', method: 'POST' })
    expect(stored.nodes[0]?.width).toBe(320)
  })

  it('strips a default handle and keeps every authored one', () => {
    const hydrated = hydrateGraph(
      {
        nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: { type: 'if-else' } }],
        edges: [
          { id: 'e1', source: 'a', target: 'a' },
          { id: 'e2', source: 'a', target: 'a', sourceHandle: 'case_abc' },
          { id: 'e3', source: 'a', target: 'a', targetHandle: 'loop-back' },
        ],
      } as unknown as GraphDocument,
      HYDRATION_OPTIONS
    )

    const stored = canonicalizeTemplateGraph(hydrated) as {
      edges: { sourceHandle?: string; targetHandle?: string }[]
    }
    // A default handle is not content — hydration restores it at every reader.
    expect(stored.edges[0]).not.toHaveProperty('sourceHandle')
    expect(stored.edges[0]).not.toHaveProperty('targetHandle')
    // A branch id is. 64 of 130 bundled-template edges carry one; stripping
    // those would destroy every branch route in the fleet.
    expect(stored.edges[1]?.sourceHandle).toBe('case_abc')
    expect(stored.edges[2]?.targetHandle).toBe('loop-back')
  })

  it('passes a non-object through — a null column, or "leave this field alone"', () => {
    expect(canonicalizeTemplateGraph(undefined)).toBeUndefined()
    expect(canonicalizeTemplateGraph(null)).toBeNull()
  })
})
