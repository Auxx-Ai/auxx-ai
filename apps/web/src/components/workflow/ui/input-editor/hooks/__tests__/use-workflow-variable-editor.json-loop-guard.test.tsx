// apps/web/src/components/workflow/ui/input-editor/hooks/__tests__/use-workflow-variable-editor.json-loop-guard.test.tsx

/**
 * Load-bearing loop-guard test for the workflow editor's JSON mode (the
 * mode used by the AI node, see `apps/web/.../workflow/nodes/core/ai/panel.tsx`).
 *
 * The AI node's `setInputs` produces a fresh `prompt_template[i].json`
 * object on every parent re-render. Without a content-hash guard, the
 * editor's `onUpdate` would bounce structurally-equal docs back to the
 * parent on every render, looping.
 *
 * The hook mitigates this with `lastSavedJsonKeyRef` — seeded with the
 * initial `valueJson`'s stable-stringified hash, then compared on every
 * `onUpdate` so structurally-equal docs are skipped.
 *
 * Strategy: stub `@tiptap/react`'s `useEditor` to capture the `onUpdate`
 * callback the hook passes in. Drive `onUpdate` manually with a fresh
 * doc object on every "render" and assert `onContentChangeJson` is not
 * called when the doc is structurally identical.
 */

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const capturedOnUpdate = {
  current: null as null | ((args: { editor: unknown }) => void),
}

/** Fire the captured onUpdate with the live mock editor instance. */
function fireUpdate() {
  if (!_lastEditor) throw new Error('useEditor was never called')
  capturedOnUpdate.current?.({ editor: _lastEditor })
}

vi.mock('@tiptap/react', () => {
  // Inline the stub editor so the factory doesn't depend on outer-scope
  // refs that don't exist at hoist-time. The real stubbedEditor below
  // mirrors this shape.
  const inlineStub = {
    getJSON: () => currentJson.current,
    getText: () => '',
    state: { doc: {} },
    storage: {},
  }
  return {
    useEditor: (options: { onUpdate?: (args: { editor: typeof inlineStub }) => void }) => {
      capturedOnUpdate.current = options.onUpdate ?? null
      _lastEditor = inlineStub
      return inlineStub
    },
    EditorContent: () => null,
  }
})

// Mirror of the inline stub so test code can directly reference it.
let _lastEditor: {
  getJSON: () => unknown
  getText: () => string
  state: object
  storage: object
} | null = null

// Tiptap dependencies pulled in by the hook — stubbed to no-ops because the
// stubbed `useEditor` above never reads them.
vi.mock('@tiptap/extension-placeholder', () => ({ default: { configure: () => ({}) } }))
vi.mock('@tiptap/starter-kit', () => ({ default: { configure: () => ({}) } }))
vi.mock('~/components/editor/extensions/variable-node', () => ({ VariableNode: {} }))
vi.mock('~/components/editor/inline-picker', () => ({
  createInlinePickerExtension: () => ({}),
  stableStringify: (value: unknown): string => {
    // Local re-impl mirroring the real one — sorted-key recursive JSON.
    const walk = (v: unknown): string => {
      if (v === null || typeof v !== 'object') return JSON.stringify(v)
      if (Array.isArray(v)) return `[${v.map(walk).join(',')}]`
      const o = v as Record<string, unknown>
      return `{${Object.keys(o)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${walk(o[k])}`)
        .join(',')}}`
    }
    return walk(value)
  },
}))
vi.mock('~/components/editor/rich-text/reference-picker-extensions', () => ({
  buildReferencePickerExtensions: () => [],
}))

import { useWorkflowVariableEditor } from '../use-workflow-variable-editor'

const currentJson = {
  current: { type: 'doc' as const, content: [{ type: 'paragraph', content: [] }] },
}

describe('useWorkflowVariableEditor — JSON-mode loop guard', () => {
  it('skips onContentChangeJson when re-rendered with structurally equal valueJson', () => {
    const onContentChangeJson = vi.fn()

    // Build a fresh-but-structurally-equal doc on every "render".
    const makeDoc = () => ({
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    })

    const { rerender } = renderHook(
      ({ valueJson }: { valueJson: ReturnType<typeof makeDoc> }) => {
        currentJson.current = valueJson
        return useWorkflowVariableEditor({
          nodeId: 'node_1',
          valueJson,
          onContentChangeJson,
        })
      },
      { initialProps: { valueJson: makeDoc() } }
    )

    // Simulate Tiptap firing onUpdate once at mount (matches real behavior
    // where the editor's initial content emit would otherwise bounce back).
    fireUpdate()

    for (let i = 0; i < 100; i += 1) {
      const next = makeDoc()
      rerender({ valueJson: next })
      // Each re-render: the live editor doc still matches; onUpdate would
      // fire on any transaction. Simulate that.
      fireUpdate()
    }

    expect(onContentChangeJson).toHaveBeenCalledTimes(0)
  })

  it('fires onContentChangeJson exactly once when content actually changes', () => {
    const onContentChangeJson = vi.fn()

    const docA = {
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    }
    currentJson.current = docA

    renderHook(() =>
      useWorkflowVariableEditor({
        nodeId: 'node_1',
        valueJson: docA,
        onContentChangeJson,
      })
    )

    // Same doc → guard dedupes.
    fireUpdate()
    expect(onContentChangeJson).toHaveBeenCalledTimes(0)

    // User edits — live doc changes.
    currentJson.current = {
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
    }
    fireUpdate()
    expect(onContentChangeJson).toHaveBeenCalledTimes(1)

    // Same content again → guard dedupes.
    fireUpdate()
    expect(onContentChangeJson).toHaveBeenCalledTimes(1)
  })
})
