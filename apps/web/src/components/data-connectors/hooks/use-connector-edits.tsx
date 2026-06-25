// apps/web/src/components/data-connectors/hooks/use-connector-edits.tsx
'use client'

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react'

/**
 * A section's save contract — its current dirty state, whether its save is in
 * flight, and a commit that persists the draft (returns the mutation promise).
 */
interface Saver {
  isDirty: boolean
  isSaving: boolean
  commit: () => Promise<unknown> | unknown
}

interface EditsStore {
  /** When true, registered sections persist their drafts automatically (setup mode). */
  autoSave: boolean
  subscribe: (cb: () => void) => () => void
  snapshot: () => { isDirty: boolean; isSaving: boolean }
  set: (id: string, saver: Saver) => void
  remove: (id: string) => void
  commitAll: () => Promise<void>
}

/**
 * A subscription store (not React state) so registering a section never re-renders
 * the registrant — only the `<SaveBar>` subscribes, and only when the aggregate
 * dirty/saving flags actually flip. `commit` closures are kept current via the
 * latest `set` while the cached snapshot stays referentially stable between flips
 * (required by `useSyncExternalStore`).
 */
function createStore(autoSave: boolean): EditsStore {
  const savers = new Map<string, Saver>()
  const listeners = new Set<() => void>()
  let cached = { isDirty: false, isSaving: false }

  const recompute = () => {
    let isDirty = false
    let isSaving = false
    for (const s of savers.values()) {
      if (s.isDirty) isDirty = true
      if (s.isSaving) isSaving = true
    }
    if (isDirty !== cached.isDirty || isSaving !== cached.isSaving) {
      cached = { isDirty, isSaving }
      for (const l of listeners) l()
    }
  }

  return {
    autoSave,
    subscribe(cb) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    snapshot: () => cached,
    set(id, saver) {
      savers.set(id, saver)
      recompute()
    },
    remove(id) {
      savers.delete(id)
      recompute()
    },
    commitAll: async () => {
      const pending = [...savers.values()].filter((s) => s.isDirty).map((s) => s.commit())
      await Promise.allSettled(pending)
    },
  }
}

const EditsContext = createContext<EditsStore | null>(null)

/**
 * Scopes one shared save buffer over the sections it wraps. Pass `autoSave` (setup
 * mode) to have sections persist their drafts automatically — no manual save click
 * before the stepper's gated "Continue".
 */
export function ConnectorEditsProvider({
  children,
  autoSave = false,
}: {
  children: ReactNode
  autoSave?: boolean
}) {
  const store = useMemo(() => createStore(autoSave), [autoSave])
  return <EditsContext.Provider value={store}>{children}</EditsContext.Provider>
}

/**
 * Register a section's dirty state + commit with the shared buffer. Re-registers
 * only when the flags flip; `commit` is always read fresh via a ref so it captures
 * the latest draft. No-ops outside a provider (e.g. a section rendered standalone).
 */
export function useRegisterSaver(
  id: string,
  isDirty: boolean,
  isSaving: boolean,
  commit: () => Promise<unknown> | unknown
) {
  const store = useContext(EditsContext)
  const commitRef = useRef(commit)
  commitRef.current = commit

  useEffect(() => {
    store?.set(id, { isDirty, isSaving, commit: () => commitRef.current() })
  }, [store, id, isDirty, isSaving])

  useEffect(() => () => store?.remove(id), [store, id])

  // Auto-save (setup mode): debounce a commit while the section is dirty. The effect
  // re-runs on every render, so continuous edits keep clearing and re-arming the
  // timer (a draft change re-renders the section); once edits settle for `DEBOUNCE_MS`
  // it fires once. A save in flight or a clean section arms nothing.
  useEffect(() => {
    if (!store?.autoSave || !isDirty || isSaving) return
    const timer = setTimeout(() => void commitRef.current(), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  })
}

const DEBOUNCE_MS = 700

const EMPTY = { isDirty: false, isSaving: false }

/** Aggregate dirty/saving state for the wrapped sections, plus a commit-all. */
export function useConnectorEdits() {
  const store = useContext(EditsContext)
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    store?.snapshot ?? (() => EMPTY),
    store?.snapshot ?? (() => EMPTY)
  )
  return {
    ...snapshot,
    autoSave: store?.autoSave ?? false,
    commitAll: store?.commitAll ?? (async () => {}),
  }
}
