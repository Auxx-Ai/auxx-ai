// apps/web/src/components/agents/procedures/ui/procedure-draft-provider.tsx
'use client'

import type { CodeOutput, LocalAttribute, TriggerExample } from '@auxx/lib/agents/procedures/client'
import type { ConditionGroup } from '@auxx/lib/conditions/client'
import { generateId } from '@auxx/utils'
import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { useQueryState } from 'nuqs'
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useDebounceCallback } from 'usehooks-ts'
import type { ReferencePickerHandle } from '~/components/pickers/reference-picker/reference-picker-content'
import type { AutosaveState } from '../../ui/shared/autosave-indicator'
import { useProcedure } from '../hooks/use-procedure'
import { useProcedureMutations } from '../hooks/use-procedure-mutations'
import type { ProcedureMeta } from '../store/procedure-store'

/**
 * The SINGLE owner of a procedure draft (v9 Phase 6). It lifts everything
 * `ProcedureEditor` used to own — the seed-once `useProcedure` load, the save-source
 * refs, the whole-doc `flush`/`commit`, every change/create handler, and the render
 * state the badges/pickers read — into ONE provider above the outer NavStack.
 *
 * Why a single writer: `saveDoc` persists the ENTIRE draft doc (no per-slice patch),
 * so two copies would clobber on flush. The root prose, a drilled sub-procedure body,
 * and a drilled code body now all write through this one owner; it outlives the
 * `procedure ↔ drill` panel switches (mounted once, keyed per procedure), so an
 * unflushed edit survives drill-in and the code panel sees the live `localAttributes`.
 *
 * Merges the old `procedure-editor-context.tsx` (the `@` reference-picker seam:
 * `insertBlock` / `createCodeBlock` / `localAttributes`), so node views keep their
 * `useProcedureEditorContext()` hook (now backed by this provider).
 */

/**
 * Starter source seeded into a new code block. Matches the runtime contract: the lambda
 * executor requires a `main(inputs)` entry point, inputs arrive as `inputs.vars.<attr>`
 * (declared local attributes; unwritten → undefined), and declared outputs are read from
 * the returned object's keys.
 */
export const DEFAULT_CODE_BLOCK_SOURCE = `function main(inputs) {
  // Read declared attributes (unwritten → undefined):
  //   const tier = inputs.vars.tier

  // Return declared outputs (only keys bound in the Outputs tab are stored):
  return {}
}
`

interface SubProcedureEntry {
  id: string
  name: string
  content: JSONContent[]
}

interface CodeBlockEntry {
  id: string
  name: string
  language: 'javascript'
  code: string
  /** Declared outputs → `var:*` (compiled onto the `code` step). No inputs in v9. */
  outputs?: CodeOutput[]
}

interface DraftDoc {
  content?: JSONContent[]
  localAttributes?: LocalAttribute[]
  subProcedures?: SubProcedureEntry[]
  codeBlocks?: CodeBlockEntry[]
}

/** Lightweight identity for a drilled body — what an inline badge needs to render. */
export interface SubProcedureMeta {
  id: string
  name: string
}

export interface CodeBlockMeta {
  id: string
  name: string
  language: 'javascript'
}

interface MetaPatch {
  name?: string
  whenToUse?: string
  triggerExamples?: TriggerExample[]
  ruleset?: ConditionGroup[]
}

/**
 * The full draft-owner contract. `ProcedureEditor` (root prose) and
 * `ProcedureDrillPanel` (drilled body) read the editor internals; node views read
 * only the picker/badge subset (via {@link useProcedureEditorContext}).
 */
export interface ProcedureDraftContextValue {
  procedureId: string
  meta: ProcedureMeta | undefined
  isLoading: boolean

  // ── root prose ──
  /** Initial main-body content (read once at mount; refs own it thereafter). */
  mainContent: JSONContent[]
  handleMainChange: (e: { json: JSONContent }) => void

  // ── drilled bodies (live, read from the save-source refs) ──
  /** Live main-body content (read from the save-source ref) — for reference scans. */
  getMainContent: () => JSONContent[]
  getSubContent: (id: string) => JSONContent[]
  makeSubChange: (id: string) => (e: { json: JSONContent }) => void
  getCodeEntry: (id: string) => CodeBlockEntry | undefined
  handleCodeChange: (id: string, code: string) => void
  handleCodeOutputsChange: (id: string, outputs: CodeOutput[]) => void

  // ── declared scratch + doc-level maps (render state) ──
  localAttributes: LocalAttribute[]
  subProcedures: SubProcedureMeta[]
  codeBlocks: CodeBlockMeta[]
  addLocalAttribute: (attr: LocalAttribute) => void
  createSubProcedure: (name: string) => string
  createCodeBlock: (name: string) => string
  renameSubProcedure: (id: string, name: string) => void
  renameCodeBlock: (id: string, name: string) => void
  deleteSubProcedure: (id: string) => void
  deleteCodeBlock: (id: string) => void

  // ── the `@` picker / shared-editor seam ──
  activeEditor: Editor | null
  handleEditorReady: (editor: Editor | null) => void
  referencePickerRef: RefObject<ReferencePickerHandle | null>
  insertBlock: (node: Record<string, unknown>) => void
  closePicker: () => void

  // ── drill (the outer NavStack `drill` param) ──
  drill: string | null
  openDrill: (key: string) => void
  closeDrill: () => void

  // ── meta write (trigger header rename / when-to-use / ruleset) ──
  patchMeta: (fields: MetaPatch) => void
}

const ProcedureDraftContext = createContext<ProcedureDraftContextValue | null>(null)

/**
 * Read the draft owner from `ProcedureEditor` / `ProcedureDrillPanel`. Returns null
 * during the brief procedure→root pop where AnimatePresence keeps the exiting panel
 * mounted after the owner already unmounted — consumers guard and render null then.
 */
export function useProcedureDraft(): ProcedureDraftContextValue | null {
  return useContext(ProcedureDraftContext)
}

/**
 * Read editor-level procedure state from inside a node view (returns null outside an
 * editor). The `@` picker / badge seam — the same surface the old
 * `procedure-editor-context.tsx` exposed.
 */
export function useProcedureEditorContext(): ProcedureDraftContextValue | null {
  return useContext(ProcedureDraftContext)
}

function readContent(content: unknown): JSONContent[] {
  return Array.isArray(content) ? (content as JSONContent[]) : []
}

interface ProcedureDraftProviderProps {
  /** Null on the `root` panel — context is null, but this component stays mounted. */
  procedureId: string | null
  /** Bumped after revert/discard (which rewrite the draft server-side) to force a re-seed. */
  reloadKey: number
  /** Lifted autosave state — feeds the detail bar's indicator. */
  onAutosaveChange?: (state: AutosaveState) => void
  children: ReactNode
}

/**
 * Mounts the draft owner ONCE above the NavStack and NEVER remounts it — it is NOT
 * React-keyed, and it renders the SAME `<Context.Provider>{children}</>` element
 * regardless of `procedureId`, so the NavStack underneath keeps its push/pop animation
 * across root↔procedure↔drill. The draft RE-SEEDS internally when `procedureId`/`reloadKey`
 * changes (the seed guard below); the parent re-keys the editor instances so they remount
 * onto the fresh slices. Context is `null` at the `root` level (no procedure selected).
 */
export function ProcedureDraftProvider({
  procedureId,
  reloadKey,
  onAutosaveChange,
  children,
}: ProcedureDraftProviderProps) {
  const { meta, draftDoc, isLoading, isLoaded } = useProcedure(procedureId)
  const { patchMeta: patchMetaRaw, saveDoc } = useProcedureMutations({
    onStateChange: onAutosaveChange,
  })
  const [drill, setDrill] = useQueryState('drill')

  const referencePickerRef = useRef<ReferencePickerHandle | null>(null)
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null)

  // Render state — what the canvas + badges read.
  const [localAttributes, setLocalAttributes] = useState<LocalAttribute[]>([])
  const [subProcedures, setSubProcedures] = useState<SubProcedureEntry[]>([])
  const [codeBlocks, setCodeBlocks] = useState<CodeBlockEntry[]>([])

  // Save-source refs — read by `flush` so debounced saves never see a stale closure.
  const mainContentRef = useRef<JSONContent[]>([])
  const localAttrRef = useRef<LocalAttribute[]>([])
  const subRef = useRef<SubProcedureEntry[]>([])
  const codeRef = useRef<CodeBlockEntry[]>([])
  const loadedRef = useRef<string | null>(null)

  // Seed every slice once per loaded procedure (async query → can't be a ref
  // initializer; seeding in render guarantees the canvas mounts with content). Keyed by
  // `${procedureId}:${reloadKey}` so a procedure switch OR a revert/discard re-seeds.
  const seedKey = procedureId ? `${procedureId}:${reloadKey}` : null
  if (isLoaded && procedureId && loadedRef.current !== seedKey) {
    loadedRef.current = seedKey
    const doc = (draftDoc ?? null) as DraftDoc | null
    mainContentRef.current = readContent(doc?.content)
    localAttrRef.current = doc?.localAttributes ?? []
    subRef.current = (doc?.subProcedures ?? []).map((s) => ({
      ...s,
      content: readContent(s.content),
    }))
    codeRef.current = doc?.codeBlocks ?? []
    setLocalAttributes(localAttrRef.current)
    setSubProcedures(subRef.current)
    setCodeBlocks(codeRef.current)
  }

  // Build + persist the draft from the live refs. EVERY building block is kept —
  // sub-procedures and code blocks are first-class parts of the procedure (authored
  // via the Building blocks popover), so they persist even when no badge references
  // them. Deleting the last badge no longer deletes the block. (No orphan sweep.)
  const flush = useCallback(() => {
    if (!procedureId) return
    saveDoc(procedureId, {
      type: 'doc',
      content: mainContentRef.current,
      localAttributes: localAttrRef.current,
      subProcedures: subRef.current,
      codeBlocks: codeRef.current,
    })
  }, [saveDoc, procedureId])

  const commit = useDebounceCallback(flush, 1500)

  const handleMainChange = useCallback(
    ({ json }: { json: JSONContent }) => {
      mainContentRef.current = readContent(json.content)
      commit()
    },
    [commit]
  )

  // Sub-procedure / code body edits write only to refs (the save source) — NOT React
  // state — so a keystroke never re-renders the whole editor. State changes only on
  // create/delete.
  const makeSubChange = useCallback(
    (id: string) =>
      ({ json }: { json: JSONContent }) => {
        subRef.current = subRef.current.map((s) =>
          s.id === id ? { ...s, content: readContent(json.content) } : s
        )
        commit()
      },
    [commit]
  )

  const handleCodeChange = useCallback(
    (id: string, code: string) => {
      codeRef.current = codeRef.current.map((c) => (c.id === id ? { ...c, code } : c))
      commit()
    },
    [commit]
  )

  // Declared outputs ride the code-block map entry (the compiler lifts them onto the
  // emitted `code` step). Written to `codeRef`, the save source — same as the body.
  const handleCodeOutputsChange = useCallback(
    (id: string, outputs: CodeOutput[]) => {
      codeRef.current = codeRef.current.map((c) => (c.id === id ? { ...c, outputs } : c))
      commit()
    },
    [commit]
  )

  const addLocalAttribute = useCallback(
    (attr: LocalAttribute) => {
      if (localAttrRef.current.some((a) => a.name === attr.name)) return
      const next = [...localAttrRef.current, attr]
      localAttrRef.current = next
      setLocalAttributes(next)
      commit()
    },
    [commit]
  )

  const createSubProcedure = useCallback(
    (name: string) => {
      const id = generateId()
      const entry: SubProcedureEntry = { id, name: name.trim() || 'Untitled', content: [] }
      const next = [...subRef.current, entry]
      subRef.current = next
      setSubProcedures(next)
      commit()
      return id
    },
    [commit]
  )

  const createCodeBlock = useCallback(
    (name: string) => {
      const id = generateId()
      const entry: CodeBlockEntry = {
        id,
        name: name.trim() || 'Code',
        language: 'javascript',
        code: DEFAULT_CODE_BLOCK_SOURCE,
      }
      const next = [...codeRef.current, entry]
      codeRef.current = next
      setCodeBlocks(next)
      commit()
      return id
    },
    [commit]
  )

  // Rename a drilled body. Writes the ref (save source) AND the render state, so the
  // drill header AND the inline badge (which resolves its label from `subProcedures` /
  // `codeBlocks`) both reflect the new name live.
  const renameSubProcedure = useCallback(
    (id: string, name: string) => {
      const next = subRef.current.map((s) => (s.id === id ? { ...s, name } : s))
      subRef.current = next
      setSubProcedures(next)
      commit()
    },
    [commit]
  )

  const renameCodeBlock = useCallback(
    (id: string, name: string) => {
      const next = codeRef.current.map((c) => (c.id === id ? { ...c, name } : c))
      codeRef.current = next
      setCodeBlocks(next)
      commit()
    },
    [commit]
  )

  const insertBlock = useCallback(
    (node: Record<string, unknown>) => {
      if (!activeEditor) return
      // Two commands, not a chain: a chained `closeReferencePicker` returning false
      // (no open chip) would abort the `insertContent`.
      activeEditor.commands.closeReferencePicker({ keepText: false })
      activeEditor.commands.insertContent(node)
      activeEditor.commands.focus()
    },
    [activeEditor]
  )

  const closePicker = useCallback(() => {
    activeEditor?.commands.closeReferencePicker({ keepText: false })
  }, [activeEditor])

  // NavStack keeps the exiting panel mounted during the slide, so the old editor's
  // unmount cleanup (`onEditorReady(null)`) can land AFTER the new one registered. Keep
  // the newest live editor: ignore a null when the current one is still alive.
  const handleEditorReady = useCallback((editor: Editor | null) => {
    setActiveEditor((prev) => {
      if (editor) return editor
      return prev?.isDestroyed === false ? prev : null
    })
  }, [])

  const openDrill = useCallback((key: string) => void setDrill(key), [setDrill])
  const closeDrill = useCallback(() => void setDrill(null), [setDrill])

  const patchMeta = useCallback(
    (fields: MetaPatch) => {
      if (procedureId) patchMetaRaw(procedureId, fields)
    },
    [patchMetaRaw, procedureId]
  )

  const getMainContent = useCallback(() => mainContentRef.current, [])
  const getSubContent = useCallback(
    (id: string) => subRef.current.find((s) => s.id === id)?.content ?? [],
    []
  )
  const getCodeEntry = useCallback((id: string) => codeRef.current.find((c) => c.id === id), [])

  // Drop a building block from the doc. Callers gate this on a zero-reference check
  // (see `useDeleteBuildingBlock`), so there's no orphan badge to sweep here. If the
  // deleted block is the one currently drilled into, pop back to the procedure level.
  const deleteSubProcedure = useCallback(
    (id: string) => {
      subRef.current = subRef.current.filter((s) => s.id !== id)
      setSubProcedures(subRef.current)
      if (drill === `sub:${id}`) closeDrill()
      commit()
    },
    [commit, drill, closeDrill]
  )

  const deleteCodeBlock = useCallback(
    (id: string) => {
      codeRef.current = codeRef.current.filter((c) => c.id !== id)
      setCodeBlocks(codeRef.current)
      if (drill === `code:${id}`) closeDrill()
      commit()
    },
    [commit, drill, closeDrill]
  )

  const value = useMemo<ProcedureDraftContextValue | null>(
    () =>
      !procedureId
        ? null
        : {
            procedureId,
            meta,
            isLoading,
            mainContent: mainContentRef.current,
            handleMainChange,
            getMainContent,
            getSubContent,
            makeSubChange,
            getCodeEntry,
            handleCodeChange,
            handleCodeOutputsChange,
            localAttributes,
            subProcedures: subProcedures.map((s) => ({ id: s.id, name: s.name })),
            codeBlocks: codeBlocks.map((c) => ({ id: c.id, name: c.name, language: c.language })),
            addLocalAttribute,
            createSubProcedure,
            createCodeBlock,
            renameSubProcedure,
            renameCodeBlock,
            deleteSubProcedure,
            deleteCodeBlock,
            activeEditor,
            handleEditorReady,
            referencePickerRef,
            insertBlock,
            closePicker,
            drill,
            openDrill,
            closeDrill,
            patchMeta,
          },
    [
      procedureId,
      meta,
      isLoading,
      handleMainChange,
      getMainContent,
      getSubContent,
      makeSubChange,
      getCodeEntry,
      handleCodeChange,
      handleCodeOutputsChange,
      localAttributes,
      subProcedures,
      codeBlocks,
      addLocalAttribute,
      createSubProcedure,
      createCodeBlock,
      renameSubProcedure,
      renameCodeBlock,
      deleteSubProcedure,
      deleteCodeBlock,
      activeEditor,
      handleEditorReady,
      insertBlock,
      closePicker,
      drill,
      openDrill,
      closeDrill,
      patchMeta,
    ]
  )

  return <ProcedureDraftContext.Provider value={value}>{children}</ProcedureDraftContext.Provider>
}
