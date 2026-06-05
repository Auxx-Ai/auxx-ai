// apps/web/src/components/agents/procedures/ui/procedure-editor.tsx
'use client'

import { type LocalAttribute, parseStepBadgeId } from '@auxx/lib/agents/procedures/client'
import { Dialog, DialogContent, DialogTitle } from '@auxx/ui/components/dialog'
import { NavStack, NavStackPanel, NavStackPanels } from '@auxx/ui/components/nav-stack'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import Section, { EmptySection } from '@auxx/ui/components/section'
import { VisuallyHidden } from '@auxx/ui/components/visually-hidden'
import { cn } from '@auxx/ui/lib/utils'
import { generateId } from '@auxx/utils'
import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { ListChecks } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useDebounceCallback } from 'usehooks-ts'
import type { ReferenceTab } from '~/components/editor/inline-picker/nodes/reference-picker-node'
import {
  PromptCharacterCount,
  PromptEditorContent,
  PromptEditorHeader,
} from '~/components/editor/prompt-editor'
import type { ReferencePickerHandle } from '~/components/pickers/reference-picker/reference-picker-content'
import CollapseWrap from '~/components/workflow/ui/collapse-wrap'
import type { AutosaveState } from '../../ui/shared/autosave-indicator'
import { useProcedure } from '../hooks/use-procedure'
import { useProcedureMutations } from '../hooks/use-procedure-mutations'
import { CodeBlockEditor } from './code-block-editor'
import { ProcedureEditorProvider } from './procedure-editor-context'
import { ProcedureTriggerHeader } from './procedure-trigger-header'

const COLLAPSED_MIN_HEIGHT = 120

// Procedures opt into the admin tabs (Tools, Resources, Fields) exactly like the
// persona editor, PLUS the procedure step tabs (Routing, Code, Sub-procedure,
// Condition, Attribute) — the `@` picker is the only insertion surface (plan §5).
// The CRM/inbox tabs from DEFAULT_TABS (people, records, messages) are dropped —
// they're meaningless inside a procedure; only `articles` carries over.
const PROCEDURE_REFERENCE_TABS: ReferenceTab[] = [
  'articles',
  'tools',
  'resources',
  'fields',
  'routing',
  'code',
  'subprocedure',
  'condition',
  'attribute',
]

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
}

interface DraftDoc {
  content?: JSONContent[]
  localAttributes?: LocalAttribute[]
  subProcedures?: SubProcedureEntry[]
  codeBlocks?: CodeBlockEntry[]
}

interface ProcedureEditorProps {
  procedureId: string
  /** Lifted autosave state — used by the page-header indicator. */
  onAutosaveChange?: (state: AutosaveState) => void
}

function readContent(content: unknown): JSONContent[] {
  return Array.isArray(content) ? (content as JSONContent[]) : []
}

/** Collect the sub-procedure / code ids referenced by inline step badges in a prose tree. */
function collectStepRefs(nodes: JSONContent[]): { subs: Set<string>; codes: Set<string> } {
  const subs = new Set<string>()
  const codes = new Set<string>()
  const walk = (node: JSONContent) => {
    if (node.type === 'reference' && typeof node.attrs?.id === 'string') {
      const badge = parseStepBadgeId(node.attrs.id)
      if (badge?.kind === 'subprocedure') subs.add(badge.subProcedureId)
      else if (badge?.kind === 'code') codes.add(badge.codeBlockId)
    }
    if (Array.isArray(node.content)) for (const child of node.content) walk(child)
  }
  for (const node of nodes) walk(node)
  return { subs, codes }
}

/**
 * The procedure authoring canvas. Visual structure is the **persona editor**
 * (`persona-editor.tsx`) verbatim — focus-gradient border, header with copy +
 * expand actions, `CollapseWrap`, the expand-to-dialog two-editor pattern — with
 * the procedure step nodes enabled and `@` as the only insertion surface.
 *
 * Drill-in: sub-procedure / code-block bodies live OUTSIDE the prose tree in the
 * doc-level `subProcedures` / `codeBlocks` maps (plan §6). The inline badge cog
 * pushes a level onto an editor-local `NavStack`; the canvas swaps to that body
 * and the header retitles + grows a back button. Each level autosaves into its own
 * map slot; the whole draft flushes as one `patch({ doc })`.
 */
export function ProcedureEditor({ procedureId, onAutosaveChange }: ProcedureEditorProps) {
  const referencePickerRef = useRef<ReferencePickerHandle | null>(null)
  const { meta, draftDoc, isLoading, isLoaded } = useProcedure(procedureId)
  const { patchMeta, saveDoc } = useProcedureMutations({ onStateChange: onAutosaveChange })
  // The heavy doc debounces at the editor level (KB's article-editor pattern);
  // the light trigger meta debounces inside `patchMeta`.
  const debouncedSaveDoc = useDebounceCallback(saveDoc, 1500)

  const [isExpanded, setExpanded] = useState(false)
  const [isFocused, setFocused] = useState(false)
  const [isCollapsed, setCollapsed] = useState(true)
  const [isCopied, setIsCopied] = useState(false)
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null)
  const [drillStack, setDrillStack] = useState<string[]>(['root'])

  // Render state — what the canvas + badges read.
  const [localAttributes, setLocalAttributes] = useState<LocalAttribute[]>([])
  const [subProcedures, setSubProcedures] = useState<SubProcedureEntry[]>([])
  const [codeBlocks, setCodeBlocks] = useState<CodeBlockEntry[]>([])

  // Save-source refs — read by `commit` so debounced flushes never see stale
  // closures. Kept in lockstep with the state setters below.
  const mainContentRef = useRef<JSONContent[]>([])
  const localAttrRef = useRef<LocalAttribute[]>([])
  const subRef = useRef<SubProcedureEntry[]>([])
  const codeRef = useRef<CodeBlockEntry[]>([])
  const loadedRef = useRef<string | null>(null)

  // Seed every slice once per loaded procedure (async query → can't be a ref
  // initializer; seeding in render guarantees the canvas mounts with content).
  if (isLoaded && loadedRef.current !== procedureId) {
    loadedRef.current = procedureId
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

  const commit = useCallback(() => {
    const content = mainContentRef.current
    const subs = subRef.current
    const codes = codeRef.current
    // Orphan sweep (plan §4 seam 5): persist only map entries still referenced by
    // a badge somewhere in the prose (main body + every sub-procedure body). We
    // filter the SAVED snapshot, not the in-memory refs, so a just-created entry
    // whose badge insert lands a tick later is never dropped (the debounce
    // coalesces to the final snapshot, which has both).
    const referenced = collectStepRefs([...content, ...subs.flatMap((s) => s.content)])
    debouncedSaveDoc(procedureId, {
      type: 'doc',
      content,
      localAttributes: localAttrRef.current,
      subProcedures: subs.filter((s) => referenced.subs.has(s.id)),
      codeBlocks: codes.filter((c) => referenced.codes.has(c.id)),
    })
  }, [debouncedSaveDoc, procedureId])

  const handleMainChange = useCallback(
    ({ json }: { json: JSONContent; html: string }) => {
      mainContentRef.current = readContent(json.content)
      commit()
    },
    [commit]
  )

  const makeSubChange = useCallback(
    (id: string) =>
      ({ json }: { json: JSONContent; html: string }) => {
        const next = subRef.current.map((s) =>
          s.id === id ? { ...s, content: readContent(json.content) } : s
        )
        subRef.current = next
        setSubProcedures(next)
        commit()
      },
    [commit]
  )

  const handleCodeChange = useCallback(
    (id: string, code: string) => {
      const next = codeRef.current.map((c) => (c.id === id ? { ...c, code } : c))
      codeRef.current = next
      setCodeBlocks(next)
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
        code: '',
      }
      const next = [...codeRef.current, entry]
      codeRef.current = next
      setCodeBlocks(next)
      commit()
      return id
    },
    [commit]
  )

  const insertBlock = useCallback(
    (node: Record<string, unknown>) => {
      if (!activeEditor) return
      // Two commands, not a chain: a chained `closeReferencePicker` returning
      // false (no open chip) would abort the `insertContent`.
      activeEditor.commands.closeReferencePicker({ keepText: false })
      activeEditor.commands.insertContent(node)
      activeEditor.commands.focus()
    },
    [activeEditor]
  )

  const closePicker = useCallback(() => {
    activeEditor?.commands.closeReferencePicker({ keepText: false })
  }, [activeEditor])

  const drillInto = useCallback((level: string) => {
    setDrillStack((prev) => (prev.includes(level) ? prev : [...prev, level]))
  }, [])

  const popDrill = useCallback(() => {
    setDrillStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
  }, [])

  const handleCopy = useCallback(() => {
    if (!activeEditor) return
    const text = activeEditor.getText()
    if (navigator.clipboard) navigator.clipboard.writeText(text)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }, [activeEditor])

  const handleUserActivity = useCallback(() => setCollapsed(false), [])

  // NavStack keeps the exiting panel mounted during the slide, so the old
  // editor's unmount cleanup (`onEditorReady(null)`) can land AFTER the new one
  // registered. Keep the newest live editor: ignore a null when the current one
  // is still alive (a real swap always re-registers a non-null editor first).
  const handleEditorReady = useCallback((editor: Editor | null) => {
    setActiveEditor((prev) => {
      if (editor) return editor
      return prev?.isDestroyed === false ? prev : null
    })
  }, [])

  const countSlot = useMemo(() => <PromptCharacterCount editor={activeEditor} />, [activeEditor])

  // Title + back reflect the drill stack: root = "Procedure", deeper = the body's name.
  const top = drillStack[drillStack.length - 1] ?? 'root'
  const title = useMemo(() => {
    if (top === 'root') return 'Procedure'
    const [kind, id] = top.split(/:(.+)/)
    if (kind === 'sub') return subProcedures.find((s) => s.id === id)?.name ?? 'Sub-procedure'
    if (kind === 'code') return codeBlocks.find((c) => c.id === id)?.name ?? 'Code'
    return 'Procedure'
  }, [top, subProcedures, codeBlocks])

  const ctxValue = useMemo(
    () => ({
      procedureId,
      localAttributes,
      addLocalAttribute,
      subProcedures: subProcedures.map((s) => ({ id: s.id, name: s.name })),
      codeBlocks: codeBlocks.map((c) => ({ id: c.id, name: c.name, language: c.language })),
      drillInto,
      createSubProcedure,
      createCodeBlock,
      insertBlock,
      closePicker,
    }),
    [
      procedureId,
      localAttributes,
      addLocalAttribute,
      subProcedures,
      codeBlocks,
      drillInto,
      createSubProcedure,
      createCodeBlock,
      insertBlock,
      closePicker,
    ]
  )

  const header = (
    <PromptEditorHeader
      title={title}
      onBack={drillStack.length > 1 ? popDrill : undefined}
      countSlot={countSlot}
      isExpanded={isExpanded}
      setExpanded={setExpanded}
      isCopied={isCopied}
      onCopy={handleCopy}
    />
  )

  // The drilled canvas for the current stack top. Sub-procedure → a fresh
  // PromptEditorContent on its slice; code → the code editor. NavStackPanels only
  // mounts the top panel (+ the one beneath during a transition), so editor
  // instances stay ~1-2 at a time despite the dynamic declaration.
  const canvas = (
    <NavStack stack={drillStack} onStackChange={setDrillStack} className='w-full'>
      <NavStackPanels>
        <NavStackPanel value='root' className='bg-transparent dark:bg-transparent shadow-none'>
          <PromptEditorContent
            initialContent={mainContentRef.current}
            onChange={handleMainChange}
            onEditorReady={handleEditorReady}
            onFocusChange={setFocused}
            onUserActivity={handleUserActivity}
            referencePickerRef={referencePickerRef}
            referenceTabs={PROCEDURE_REFERENCE_TABS}
            enableProcedureNodes
          />
        </NavStackPanel>
        {subProcedures.map((s) => (
          <NavStackPanel
            key={s.id}
            value={`sub:${s.id}`}
            className='bg-transparent dark:bg-transparent shadow-none'>
            <PromptEditorContent
              initialContent={s.content}
              onChange={makeSubChange(s.id)}
              onEditorReady={handleEditorReady}
              onFocusChange={setFocused}
              onUserActivity={handleUserActivity}
              referencePickerRef={referencePickerRef}
              referenceTabs={PROCEDURE_REFERENCE_TABS}
              enableProcedureNodes
            />
          </NavStackPanel>
        ))}
        {codeBlocks.map((c) => (
          <NavStackPanel
            key={c.id}
            value={`code:${c.id}`}
            className='bg-transparent dark:bg-transparent shadow-none'>
            <CodeBlockEditor code={c.code} onChange={(code) => handleCodeChange(c.id, code)} />
          </NavStackPanel>
        ))}
      </NavStackPanels>
    </NavStack>
  )

  console.log('isFocused', isFocused)
  if (isLoading || !meta) return <EmptySection loading className='mx-3 my-3' />

  return (
    <ProcedureEditorProvider value={ctxValue}>
      <ProcedureTriggerHeader
        key={procedureId}
        whenToUse={meta.whenToUse}
        triggerExamples={meta.triggerExamples}
        ruleset={meta.ruleset}
        localAttributes={localAttributes}
        onPatch={(p) => patchMeta(procedureId, p)}
      />
      <Section
        title='When to use'
        icon={<ListChecks className='size-4' />}
        description='Describe the situation that should select this procedure.'
        initialOpen
        collapsible={false}>
        <div
          className={cn(
            isFocused && !isExpanded
              ? 'bg-gradient-to-r from-[#0ba5ec] to-[#155aef]'
              : 'bg-transparent',
            '!rounded-[9px] p-0.5 me-1'
          )}>
          <div
            className={cn(isFocused ? 'bg-background' : 'bg-primary-200/30', 'rounded-lg border')}>
            {header}
            {!isExpanded && (
              <CollapseWrap
                minHeight={COLLAPSED_MIN_HEIGHT}
                isCollapsed={isCollapsed}
                onCollapsedChange={setCollapsed}
                className='px-3'
                gradientClassName='from-primary-200/30 dark:from-primary-200/30'>
                <div className='relative flex w-full'>{canvas}</div>
              </CollapseWrap>
            )}
          </div>
        </div>
      </Section>

      <Dialog open={isExpanded} onOpenChange={setExpanded}>
        <DialogContent size='3xl' innerClassName='h-[80vh] flex flex-col p-0' showClose={false}>
          <VisuallyHidden>
            <DialogTitle>{title}</DialogTitle>
          </VisuallyHidden>
          <div className='shrink-0 border-b'>{header}</div>
          <div className='flex-1 min-h-0 overflow-hidden'>
            <ScrollArea
              className='relative h-full min-h-0 px-3 flex-1 flex'
              fadeClassName=''
              allowScrollChaining
              scrollbarClassName='w-1 mr-0.5 data-[hovering]:opacity-0 hover:!opacity-100'>
              {isExpanded && canvas}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </ProcedureEditorProvider>
  )
}
