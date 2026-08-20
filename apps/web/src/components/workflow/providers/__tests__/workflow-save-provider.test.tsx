// apps/web/src/components/workflow/providers/__tests__/workflow-save-provider.test.tsx
//
// Plan 22 (`plans/kopilot/workflow/22-draft-save-discipline.md`), phases B–E:
// the draft write path has ONE owner, and that owner has an OPINION ABOUT WHAT
// A CHANGE IS.
//
// Phase B pinned singularity — one pending set, one timer, one latch, where
// there used to be ~15 of each. Phases C–E pin the thing the singularity was
// for: a save is content-guarded, not trigger-guarded. `projectGraphSemantics`
// and `dehydrateGraph` are therefore imported FOR REAL here (the projection is
// the unit under test — mocking it would test nothing), while everything with a
// network or a canvas behind it is faked.

import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Plan 22 §5 D3 — 1500 ms quiet period, 10 s ceiling. */
const DEBOUNCE_MS = 1500

interface TestGraph {
  nodes: Record<string, unknown>[]
  edges: Record<string, unknown>[]
  viewport?: { x: number; y: number; zoom: number }
}

const h = vi.hoisted(() => {
  const state: Record<string, any> = {}
  return {
    state,
    /** Every payload handed to `api.workflow.update` — the count under test. */
    calls: [] as Record<string, any>[],
    /** Options object react-query was configured with (onSuccess / onError). */
    opts: null as any,
    /** When set, the next mutation rejects with this error. */
    nextError: null as any,
    /** When set, the next mutation blocks on this before resolving (single-flight probe). */
    gate: null as Promise<void> | null,
    /** What React Flow's store is currently holding — mutated per test. */
    graph: { nodes: [], edges: [] } as { nodes: unknown[]; edges: unknown[] },
    toastError: vi.fn(),
  }
})

vi.mock('@auxx/ui/components/toast', () => ({
  toastError: (...args: unknown[]) => h.toastError(...args),
}))

vi.mock('@xyflow/react', () => ({
  useStoreApi: () => ({
    getState: () => ({
      nodes: h.graph.nodes,
      edges: h.graph.edges,
      // Deliberately absurd: the live camera must NEVER reach the payload.
      transform: [999, 888, 2],
    }),
  }),
}))

vi.mock('~/hooks/use-analytics', () => ({ useAnalytics: () => null }))

vi.mock('~/trpc/react', () => ({
  api: {
    workflow: {
      update: {
        useMutation: (opts: unknown) => {
          h.opts = opts
          return {
            isPending: false,
            mutateAsync: async (payload: Record<string, any>) => {
              h.calls.push(payload)
              // One-shot: only the request that opened the gate waits on it.
              const gate = h.gate
              h.gate = null
              if (gate) await gate
              if (h.nextError) {
                const error = h.nextError
                h.nextError = null
                await h.opts?.onError?.(error)
                throw error
              }
              const result = { id: 'wfapp-1', graphHash: `hash-${h.calls.length + 1}` }
              await h.opts?.onSuccess?.(result)
              return result
            },
          }
        },
      },
    },
  },
}))

vi.mock('../../hooks/use-read-only', () => ({ useReadOnly: () => ({ isReadOnly: false }) }))

vi.mock('../../nodes/unified-registry', () => ({
  unifiedNodeRegistry: { getDefinition: () => undefined },
}))

vi.mock('../../store/canvas-store', () => ({
  useCanvasStore: { getState: () => ({ readOnly: false }) },
}))
vi.mock('../../store/run-store', () => ({
  useRunStore: { getState: () => ({ runViewMode: 'none', isRunning: false }) },
}))
vi.mock('../../store/use-var-store', () => ({
  useVarStore: { getState: () => ({ environmentVariables: h.state.envVars ?? new Map() }) },
}))
vi.mock('../../store/test-input-store', () => ({
  useTestInputStore: { getState: () => ({ getVariablesForSave: () => h.state.testVars ?? [] }) },
}))

vi.mock('../../store/workflow-store', () => ({
  useWorkflowStore: Object.assign((selector: (s: unknown) => unknown) => selector(h.state), {
    getState: () => h.state,
    setState: (partial: Record<string, unknown>) => Object.assign(h.state, partial),
  }),
}))

import { useWorkflowSave } from '../../hooks/use-workflow-save'
import { useWorkflowStore } from '../../store/workflow-store'
import { projectEnvVars, projectGraph } from '../../utils/save-baseline'
import { WorkflowSaveProvider } from '../workflow-save-provider'

// ── fixtures ────────────────────────────────────────────────────────────────

/**
 * The document as the server stores it — a Kopilot-authored shape, which is the
 * hard case: no `sourceType`/`targetType` on the edge, no `zIndex`, no
 * `node.type`, no `sourceHandle`/`targetHandle` (720 stored edges omit them).
 */
function storedGraph(): TestGraph {
  return {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { type: 'manual', title: 'Manual' } },
      {
        id: 'n2',
        position: { x: 240, y: 0 },
        data: { type: 'ai', title: 'Answer', prompt: 'hi' },
      },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    viewport: { x: 11, y: 22, zoom: 0.75 },
  }
}

/**
 * What React Flow holds after `initializeWorkflow` ran and the user merely
 * LOOKED at the workflow: the restored selection replayed, nodes were measured,
 * every derived field was re-manufactured. Byte-for-byte a different document;
 * projection-for-projection the same workflow.
 */
function hydratedWithChurn(): TestGraph {
  return {
    nodes: [
      {
        id: 'n1',
        type: 'standard',
        position: { x: 0, y: 0 },
        selected: true,
        dragging: false,
        selectable: true,
        measured: { width: 260, height: 84 },
        width: 260,
        height: 84,
        zIndex: 1,
        data: {
          type: 'manual',
          title: 'Manual',
          isValid: true,
          errors: [],
          _connectedSourceHandleIds: ['source'],
        },
      },
      {
        id: 'n2',
        type: 'standard',
        position: { x: 240, y: 0 },
        selected: false,
        measured: { width: 260, height: 120 },
        width: 260,
        height: 120,
        zIndex: 1,
        data: { type: 'ai', title: 'Answer', prompt: 'hi', isValid: true, errors: [] },
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        sourceHandle: 'source',
        targetHandle: 'target',
        zIndex: 1001,
        data: { sourceType: 'manual', targetType: 'ai', isInLoop: false },
      },
    ],
  }
}

/** Seed the stores the way `applyFetchedWorkflow` does on load / rehydrate. */
function loadWorkflow(stored: TestGraph, live: TestGraph = hydratedWithChurn()) {
  h.state.saveBaseline = { graph: projectGraph(stored), envText: projectEnvVars([], []) }
  h.state.authoredViewport = stored.viewport ?? null
  h.graph = { nodes: live.nodes, edges: live.edges }
}

// ── harness ─────────────────────────────────────────────────────────────────

/**
 * A distinct `useWorkflowSave()` call site — the shape that used to own its own
 * pending set, timer and latch.
 */
function Consumer({ register }: { register: (api: ReturnType<typeof useWorkflowSave>) => void }) {
  register(useWorkflowSave())
  return null
}

/** Mount the provider with two independent consumers, as the builder does. */
function mountEditor() {
  const consumers: ReturnType<typeof useWorkflowSave>[] = []
  render(
    <WorkflowSaveProvider>
      <Consumer
        register={(api) => {
          consumers[0] = api
        }}
      />
      <Consumer
        register={(api) => {
          consumers[1] = api
        }}
      />
    </WorkflowSaveProvider>
  )
  return consumers
}

/** Run the debounce out and let the mutation's promise chain settle. */
async function flushSaves(ms = DEBOUNCE_MS) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
  await act(async () => {})
}

/** Edit a node's config the way a panel does. */
function editNode(nodeId: string, patch: Record<string, unknown>) {
  h.graph.nodes = h.graph.nodes.map((node) => {
    const record = node as Record<string, any>
    if (record.id !== nodeId) return node
    return { ...record, data: { ...record.data, ...patch } }
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  h.calls.length = 0
  h.opts = null
  h.nextError = null
  h.gate = null
  h.toastError.mockClear()
  for (const key of Object.keys(h.state)) delete h.state[key]
  Object.assign(h.state, {
    workflow: {
      id: 'wfapp-1',
      name: 'Untitled workflow',
      description: '',
      triggerType: 'manual',
      graphHash: 'hash-1',
    },
    metadata: { id: 'wf-row' },
    workflowAppId: 'wfapp-1',
    isDirty: false,
    error: null,
    isViewerMode: false,
    instanceReadOnly: false,
    queueSave: null,
    envVars: new Map(),
    testVars: [] as unknown[],
    saveBaseline: { graph: null, envText: null },
    authoredViewport: null,
    setSaveBaseline: (patch: Record<string, unknown>) => {
      h.state.saveBaseline = { ...h.state.saveBaseline, ...patch }
    },
    markDirty: () => {
      h.state.isDirty = true
    },
    markClean: () => {
      h.state.isDirty = false
    },
    setWorkflow: (workflow: Record<string, unknown>) => {
      // Mirrors the real store since phase D: a server response refreshes the
      // CAS token and does NOT set `isDirty`.
      h.state.workflow = { ...h.state.workflow, ...workflow }
    },
  })
  loadWorkflow(storedGraph())
})

// ── phase C: the content guard ──────────────────────────────────────────────

describe('content guard — a save is content-guarded, not trigger-guarded', () => {
  it('load → mount churn (selection replay, measurement, re-derivation) ⇒ ZERO mutations', async () => {
    const [a] = mountEditor()

    // Everything an open does on its own: the restored selection replays and
    // opens a panel, the panel re-centres the canvas, nodes get measured.
    act(() => {
      a.debouncedSave()
    })
    await flushSaves()

    expect(h.calls).toHaveLength(0)
    expect(h.state.isDirty).toBe(false)
  })

  it('a Kopilot-shaped graph (no sourceType / zIndex / handles on edges) ⇒ still ZERO mutations', async () => {
    // `storedGraph()` IS the Kopilot shape; the live graph is what
    // `initializeWorkflow` manufactured on top of it. This is the diff that
    // sank every previous attempt — the LOAD PATH made a real document change,
    // so suppressing one trigger just moved the write to the next one.
    const stored = storedGraph()
    expect(stored.edges[0]).not.toHaveProperty('sourceHandle')
    expect(stored.edges[0]).not.toHaveProperty('data')
    expect(h.graph.edges[0]).toHaveProperty('sourceHandle', 'source')

    const [a] = mountEditor()
    act(() => {
      a.debouncedSave()
    })
    await flushSaves()

    expect(h.calls).toHaveLength(0)
  })

  it('a node MOVE is content — dragging is an edit, not churn', async () => {
    const [a] = mountEditor()

    h.graph.nodes = h.graph.nodes.map((node) => {
      const record = node as Record<string, any>
      return record.id === 'n2' ? { ...record, position: { x: 600, y: 40 } } : node
    })

    act(() => {
      a.debouncedSave()
    })
    await flushSaves()

    expect(h.calls).toHaveLength(1)
  })

  it('one real edit ⇒ exactly one mutation, echoing the server CAS token and the AUTHORED viewport', async () => {
    const [a] = mountEditor()

    editNode('n2', { prompt: 'answer the customer' })
    act(() => {
      a.debouncedSave()
    })
    expect(h.calls).toHaveLength(0) // still debounced

    await flushSaves()

    expect(h.calls).toHaveLength(1)
    const payload = h.calls[0]
    expect(payload.graph).toBeDefined()

    // The CAS token is ECHOED from the server, never recomputed client-side:
    // the server re-hashes the RAW stored column, so a local hash would 409
    // forever.
    expect(payload.expectedGraphHash).toBe('hash-1')

    // The viewport is the one this editor LOADED, verbatim — never the live
    // camera (`transform` is [999, 888, 2] in this harness).
    expect(payload.graph.viewport).toEqual({ x: 11, y: 22, zoom: 0.75 })

    // Dehydrated on the way out: the canvas's own state never reaches the row.
    expect(payload.graph.nodes[0]).not.toHaveProperty('selected')
    expect(payload.graph.nodes[0]).not.toHaveProperty('measured')
    expect(payload.graph.edges[0]).not.toHaveProperty('zIndex')

    // The response refreshed the CAS token for the next save.
    expect(h.state.workflow.graphHash).toBe('hash-2')
    expect(h.state.isDirty).toBe(false)
  })

  it('the save response becomes the new baseline — an identical re-queue sends nothing', async () => {
    const [a] = mountEditor()

    editNode('n2', { prompt: 'answer the customer' })
    act(() => {
      a.debouncedSave()
    })
    await flushSaves()
    expect(h.calls).toHaveLength(1)

    // Nothing changed since; the guard has to know that from the request it
    // just sent, not from whatever the router chose to echo back.
    act(() => {
      a.debouncedSave()
    })
    await flushSaves()
    expect(h.calls).toHaveLength(1)
  })

  it('a loop container RESIZE changes the projection; a measurement writeback does not', async () => {
    const stored: TestGraph = {
      nodes: [
        {
          id: 'loop-1',
          position: { x: 0, y: 0 },
          data: { type: 'loop', title: 'Loop', width: 620, height: 340 },
        },
      ],
      edges: [],
    }
    const live: TestGraph = {
      nodes: [
        {
          id: 'loop-1',
          type: 'standard',
          position: { x: 0, y: 0 },
          width: 620,
          height: 340,
          data: { type: 'loop', title: 'Loop', width: 620, height: 340 },
        },
      ],
      edges: [],
    }
    loadWorkflow(stored, live)

    const [a] = mountEditor()

    // A `ResizeObserver` writeback: the TOP-LEVEL pair only. Persisted, never
    // a trigger.
    h.graph.nodes = [{ ...(h.graph.nodes[0] as Record<string, any>), width: 621, height: 341 }]
    act(() => {
      a.debouncedSave()
    })
    await flushSaves()
    expect(h.calls).toHaveLength(0)

    // `handleNodeResize` writes `data.width`/`data.height` as well — an
    // AUTHORED size, and content.
    const node = h.graph.nodes[0] as Record<string, any>
    h.graph.nodes = [{ ...node, data: { ...node.data, width: 900, height: 500 } }]
    act(() => {
      a.debouncedSave()
    })
    await flushSaves()
    expect(h.calls).toHaveLength(1)
  })

  it('envVars are guarded the same way — an unchanged set sends nothing, a changed one sends once', async () => {
    const [a] = mountEditor()

    act(() => {
      a.saveEnvVars()
    })
    await flushSaves()
    expect(h.calls).toHaveLength(0)

    h.state.envVars = new Map([['env.API_KEY', { id: 'env.API_KEY', name: 'API_KEY', value: 'x' }]])
    act(() => {
      a.saveEnvVars()
    })
    await flushSaves()

    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].envVars).toHaveLength(1)
    // Env-only save: the graph never rides along. The old dirty-fallback turned
    // exactly this into a graph write.
    expect(h.calls[0].graph).toBeUndefined()
  })

  it('a name change rides alone when the graph is unchanged', async () => {
    const [a, b] = mountEditor()

    act(() => {
      a.debouncedSave() // churn only
      b.saveMetadata({ name: 'Renamed' })
    })
    await flushSaves()

    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].name).toBe('Renamed')
    expect(h.calls[0].graph).toBeUndefined()
    expect(h.calls[0].expectedGraphHash).toBeUndefined()
  })

  it('§9.3f — the Kopilot dirty gate: churn leaves isDirty false, so panning cannot block a mutation', async () => {
    const [a] = mountEditor()

    // `kopilot-context.tsx` feeds `workflow-store.isDirty` into
    // `workflow-authoring-guard.ts`, which REFUSES every mutation while dirty.
    // Before the content guard, that flag was set by a pan.
    act(() => {
      a.debouncedSave()
    })
    expect(h.state.isDirty).toBe(true) // queued, verdict not in yet

    await flushSaves()

    expect(h.calls).toHaveLength(0)
    expect(h.state.isDirty).toBe(false) // …and the gate is open again
  })
})

// ── phase B: one owner ──────────────────────────────────────────────────────

describe('WorkflowSaveProvider — one owner for the draft write path', () => {
  it('two edits from two different consumers 100 ms apart ⇒ exactly one mutation', async () => {
    const [a, b] = mountEditor()

    editNode('n2', { prompt: 'first' })
    act(() => {
      a.debouncedSave()
    })
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    act(() => {
      b.saveMetadata({ name: 'Renamed' })
    })

    // One shared timer: the second queue RESCHEDULES it rather than arming a
    // second one, so nothing fires until the quiet period after the LAST edit.
    await flushSaves(DEBOUNCE_MS - 100)
    expect(h.calls).toHaveLength(0)

    await flushSaves(100)

    expect(h.calls).toHaveLength(1)
    // …and the single request carries BOTH consumers' changes.
    expect(h.calls[0].graph).toBeDefined()
    expect(h.calls[0].name).toBe('Renamed')
  })

  it('a 409 ⇒ one toast, latch engaged, no further saves from any consumer', async () => {
    const [a, b] = mountEditor()

    h.nextError = {
      message: 'The draft changed while you were editing.',
      data: { code: 'CONFLICT' },
    }

    editNode('n2', { prompt: 'conflicting edit' })
    act(() => {
      a.debouncedSave()
    })
    await flushSaves()

    expect(h.calls).toHaveLength(1)
    expect(h.toastError).toHaveBeenCalledTimes(1)
    const toastArgs = h.toastError.mock.calls[0][0]
    expect(toastArgs.title).toBe('Workflow changed elsewhere')
    expect(toastArgs.actions[0].label).toBe('Reload')

    // The latch is shared, so NEITHER consumer can start another save…
    act(() => {
      a.debouncedSave()
      b.saveMetadata({ name: 'Renamed after conflict' })
    })
    await flushSaves()
    expect(h.calls).toHaveLength(1)

    // …not even an explicit Save (Mod+S / the toolbar button).
    await act(async () => {
      await b.saveNow()
    })
    expect(h.calls).toHaveLength(1)
    expect(h.toastError).toHaveBeenCalledTimes(1)
  })

  it('registers queueSave into the workflow store for the non-React callers', async () => {
    mountEditor()

    const queueSave = useWorkflowStore.getState().queueSave
    expect(typeof queueSave).toBe('function')

    editNode('n2', { prompt: 'from a store' })
    act(() => {
      queueSave?.({ graph: true })
    })
    await flushSaves()

    expect(h.calls).toHaveLength(1)
  })

  it('single-flight: a save queued mid-request runs after the response, never beside it', async () => {
    const [a, b] = mountEditor()

    // Hold the first request open so a second save arrives while it is in flight.
    let release!: () => void
    h.gate = new Promise<void>((resolve) => {
      release = resolve
    })

    editNode('n2', { prompt: 'first' })
    act(() => {
      a.debouncedSave()
    })
    await flushSaves()
    expect(h.calls).toHaveLength(1)

    // Queued mid-flight, and its debounce fires while the first request is
    // still open. That must NOT open a second concurrent request — it raises
    // `saveAgain` and joins the running chain.
    act(() => {
      b.saveMetadata({ name: 'Mid-flight rename' })
    })
    await flushSaves()
    expect(h.calls).toHaveLength(1)

    await act(async () => {
      release()
    })
    await act(async () => {})

    // It ran afterwards, on the token the first response refreshed.
    expect(h.calls).toHaveLength(2)
    expect(h.calls[1].name).toBe('Mid-flight rename')
  })

  it('an explicit Save with nothing queued resolves true — the pending set is the whole record', async () => {
    const [a] = mountEditor()

    // `use-run-single-node.ts:109` saves before running and aborts the run on a
    // falsy result. With the dirty-fallback gone, "nothing queued" means
    // already up to date, not failed.
    h.state.isDirty = true
    let saved: boolean | undefined
    await act(async () => {
      saved = await a.saveNow()
    })

    expect(saved).toBe(true)
    expect(h.calls).toHaveLength(0)
    expect(h.state.isDirty).toBe(false)
  })

  it('maxWait: a burst that never stops still persists', async () => {
    const [a] = mountEditor()

    editNode('n2', { prompt: 'typing' })
    // Re-queue faster than the debounce for well past the 10 s ceiling.
    for (let tick = 0; tick < 15; tick++) {
      act(() => {
        a.debouncedSave()
      })
      await act(async () => {
        vi.advanceTimersByTime(1000)
      })
    }
    await act(async () => {})

    expect(h.calls.length).toBeGreaterThanOrEqual(1)
  })
})

// ── phase E: the terminal save ──────────────────────────────────────────────

describe('terminal save — no blind writes', () => {
  function hide() {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('visibilitychange → hidden flushes through the NORMAL path, and the response refreshes the token', async () => {
    const [a] = mountEditor()

    editNode('n2', { prompt: 'edited then switched tabs' })
    act(() => {
      a.debouncedSave()
    })
    await act(async () => {
      vi.advanceTimersByTime(100) // still debounced
    })
    expect(h.calls).toHaveLength(0)

    await act(async () => {
      hide()
    })
    await act(async () => {})

    // A tRPC save — NOT a beacon — so its response is read.
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].expectedGraphHash).toBe('hash-1')
    expect(h.state.workflow.graphHash).toBe('hash-2')

    // …and the next edit therefore saves cleanly instead of 409ing forever.
    editNode('n2', { prompt: 'edited after coming back' })
    act(() => {
      a.debouncedSave()
    })
    await flushSaves()

    expect(h.calls).toHaveLength(2)
    expect(h.calls[1].expectedGraphHash).toBe('hash-2')
    expect(h.toastError).not.toHaveBeenCalled()
  })

  it('pagehide with a real diff ⇒ ONE keepalive fetch, and markClean only after a 2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: vi.fn() })

    mountEditor()
    editNode('n2', { prompt: 'unsaved when the tab closed' })
    h.state.isDirty = true

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    await act(async () => {})

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/workflows/wfapp-1')
    expect(init.method).toBe('POST')
    expect(init.keepalive).toBe(true)
    expect(JSON.parse(init.body).graph).toBeDefined()

    // The beacon branch is gone — it wrote without ever reading the response.
    expect(navigator.sendBeacon).not.toHaveBeenCalled()
    expect(h.state.isDirty).toBe(false)

    vi.unstubAllGlobals()
  })

  it('pagehide with a clean content guard ⇒ NO write at all, even while isDirty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    mountEditor()
    // The stale flag the old beacon trusted — set by a pan, a click, a
    // server response. The graph itself is untouched.
    h.state.isDirty = true

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    await act(async () => {})

    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('a non-2xx terminal response leaves the editor dirty', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409 })
    vi.stubGlobal('fetch', fetchMock)

    mountEditor()
    editNode('n2', { prompt: 'rejected by the CAS' })
    h.state.isDirty = true

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    await act(async () => {})

    expect(fetchMock).toHaveBeenCalledTimes(1)
    // `markClean()` on a mere enqueue is what made the UI claim dropped work
    // had been saved.
    expect(h.state.isDirty).toBe(true)

    vi.unstubAllGlobals()
  })
})
