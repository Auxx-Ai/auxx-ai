// apps/web/src/components/editor/inline-picker/hooks/use-external-content-sync.ts
'use client'

import type { Editor } from '@tiptap/react'
import { type RefObject, useEffect, useRef } from 'react'

interface UseExternalContentSyncArgs<TContent> {
  editor: Editor | null
  /** The doc that should be on screen according to the server. */
  incoming: TContent
  /** Picker open state — defer sync while open, flush on close. */
  isPickerOpen: boolean
  /** How to set the editor content. Editor-specific (HTML vs JSON). */
  applyContent: (editor: Editor, content: TContent) => void
  /**
   * Canonical key for `content`. Must be stable across semantically-equal
   * docs — for JSON, this means a key-order-insensitive stringify, otherwise
   * the same doc round-tripping through the DB (which reorders JSONB keys)
   * compares unequal and the hook re-applies on every save echo.
   */
  canonicalKey: (content: TContent) => string
}

export interface ExternalContentSyncHandle {
  /**
   * Call from `onUpdate` (after the change has been propagated to the
   * parent) with the canonical key of the doc we just sent out — this
   * becomes the `lastAppliedKey`, so an inbound echo of the same doc is a
   * no-op.
   */
  markLocalEdit: (key: string) => void
}

// Echo-detection window. Each local edit's canonical key goes into a bounded
// ring, so when the server-saved content (or any other parent-driven
// `incoming` reflecting a recent local edit) shows up later, we recognize it
// as our own echo and skip — even when the editor has already typed past it.
// Without this, a stale echo overwrites the user's live edits with an older
// doc (cursor jumps, reference-picker chip vanishes and re-mounts).
const LOCAL_EDIT_RING_SIZE = 64

/**
 * Gate that prevents the editor's content-sync effect from clobbering the
 * live document when the server echoes back content we just sent. The hook
 * owns:
 *
 * - A `lastAppliedKey` ref updated on every inbound apply and on every
 *   outbound local edit (via the returned handle).
 * - A bounded ring of recent local-edit keys so an out-of-order or
 *   typed-past server echo is recognized and skipped, not just the most
 *   recent one.
 * - A `pending` ref that stashes incoming content while a slash/inline
 *   picker is open and flushes it the moment the picker closes.
 *
 * Same shape applies to every TipTap editor that gets fed content from
 * outside its own `onUpdate` (queries, SSE, AI tools).
 */
export function useExternalContentSync<TContent>({
  editor,
  incoming,
  isPickerOpen,
  applyContent,
  canonicalKey,
}: UseExternalContentSyncArgs<TContent>): RefObject<ExternalContentSyncHandle> {
  const lastAppliedKeyRef = useRef<string | null>(null)
  const pendingRef = useRef<TContent | null>(null)
  // Bounded ring of recent locally-marked keys (most recent first). `Set`
  // wrapping a `string[]` so we get O(1) hit-tests without unbounded growth.
  const localEditRingRef = useRef<string[]>([])
  const localEditSetRef = useRef<Set<string>>(new Set())
  const recordLocalEdit = (key: string) => {
    if (localEditSetRef.current.has(key)) return
    localEditRingRef.current.unshift(key)
    localEditSetRef.current.add(key)
    if (localEditRingRef.current.length > LOCAL_EDIT_RING_SIZE) {
      const evicted = localEditRingRef.current.pop()
      if (evicted !== undefined) localEditSetRef.current.delete(evicted)
    }
  }
  const handleRef = useRef<ExternalContentSyncHandle>({
    markLocalEdit: (key) => {
      lastAppliedKeyRef.current = key
      recordLocalEdit(key)
      // A local edit supersedes anything stashed while the picker is open —
      // flushing the stash on picker-close would otherwise clobber the fresh
      // edit (e.g. slash-command insertions while a save is in flight).
      pendingRef.current = null
    },
  })

  // Read picker state without depending on it — otherwise the inbound effect
  // re-runs when the picker closes after a slash command and re-applies the
  // stale `incoming` doc on top of the freshly-executed edit. Picker close
  // is handled by the dedicated flush effect below.
  const isPickerOpenRef = useRef(isPickerOpen)
  useEffect(() => {
    isPickerOpenRef.current = isPickerOpen
  }, [isPickerOpen])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const key = canonicalKey(incoming)
    if (key === lastAppliedKeyRef.current) return
    // Echo of one of our own recent edits — the editor has typed past this
    // version, so applying it would revert live edits. Trust the editor.
    if (localEditSetRef.current.has(key)) return
    if (isPickerOpenRef.current) {
      pendingRef.current = incoming
      return
    }
    applyContent(editor, incoming)
    lastAppliedKeyRef.current = key
    pendingRef.current = null
  }, [editor, incoming, applyContent, canonicalKey])

  const prevOpen = useRef(false)
  useEffect(() => {
    if (prevOpen.current && !isPickerOpen && editor && pendingRef.current) {
      const pending = pendingRef.current
      const key = canonicalKey(pending)
      if (key !== lastAppliedKeyRef.current && !localEditSetRef.current.has(key)) {
        applyContent(editor, pending)
        lastAppliedKeyRef.current = key
      }
      pendingRef.current = null
    }
    prevOpen.current = isPickerOpen
  }, [isPickerOpen, editor, applyContent, canonicalKey])

  return handleRef
}

/**
 * Imperative variant for editors that push content without a single
 * `incoming` prop driving an effect (AI tools, template inserts). Wraps
 * `editor.commands.setContent` with the same `lastAppliedKey` guard so
 * duplicate writes from external sources no-op, and so `onUpdate` callers
 * can stamp the freshly-edited key via `markLocalEdit`.
 */
export interface ContentApplier<TContent> {
  apply: (content: TContent) => void
  markLocalEdit: (key: string) => void
}

export function makeContentApplier<TContent>(
  editor: Editor | null,
  applyContent: (editor: Editor, content: TContent) => void,
  canonicalKey: (content: TContent) => string
): ContentApplier<TContent> {
  let lastAppliedKey: string | null = null
  return {
    apply: (content) => {
      if (!editor || editor.isDestroyed) return
      const key = canonicalKey(content)
      if (key === lastAppliedKey) return
      applyContent(editor, content)
      lastAppliedKey = key
    },
    markLocalEdit: (key) => {
      lastAppliedKey = key
    },
  }
}

/**
 * Stable, key-order-insensitive stringify for use as a canonical key in
 * `useExternalContentSync` / `makeContentApplier`. Required because the
 * server round-trips `contentJson` through a JSONB column, which doesn't
 * preserve insertion order — plain `JSON.stringify` returns different
 * strings for the same logical doc and breaks the inbound-skip path.
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value ?? null)
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
  return `{${entries.join(',')}}`
}
