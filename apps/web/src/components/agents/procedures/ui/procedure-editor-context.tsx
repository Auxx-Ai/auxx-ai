// apps/web/src/components/agents/procedures/ui/procedure-editor-context.tsx
'use client'

import type { LocalAttribute } from '@auxx/lib/agents/procedures/client'
import { createContext, type ReactNode, useContext } from 'react'

/** Lightweight identity for a drilled body — what the inline badge needs to render. */
export interface SubProcedureMeta {
  id: string
  name: string
}

export interface CodeBlockMeta {
  id: string
  name: string
  language: 'javascript'
}

/**
 * Editor-level shared state the procedure node views + inline step badges read.
 * Node views render in their own React roots but DO see app-level context that
 * wraps `<EditorContent>` (only sibling/parent NODE-VIEW context is unreachable —
 * see panel-node-view.tsx). So the procedure editor wraps its canvas in this
 * provider and the badges / condition views consume:
 *
 * - `localAttributes` — declared scratch (the "Temporary" attribute group),
 * - the `subProcedures` / `codeBlocks` maps (drilled bodies, by id) — badges
 *   resolve their display name + the cog's drill target from here,
 * - `drillInto` — push a level onto the editor's NavStack (the cog action),
 *
 * rather than threading props through TipTap. Returns `null` outside an editor.
 */
export interface ProcedureEditorContextValue {
  procedureId: string
  /** Declared procedure-local scratch (the doc's `localAttributes`). */
  localAttributes: LocalAttribute[]
  /** Append a new declared local attribute (the "Create attribute" affordance). */
  addLocalAttribute: (attr: LocalAttribute) => void
  /** Sub-procedure bodies declared in this doc (drilled via the `subprocedure:` badge cog). */
  subProcedures: SubProcedureMeta[]
  /** Code-block bodies declared in this doc (drilled via the `code:` badge cog). */
  codeBlocks: CodeBlockMeta[]
  /** Push a drill level onto the editor NavStack — e.g. `sub:<id>` or `code:<id>`. */
  drillInto: (level: string) => void
  /** Create a sub-procedure body (picker "new") → returns its id for the badge. */
  createSubProcedure: (name: string) => string
  /** Create a code-block body (picker "new") → returns its id for the badge. */
  createCodeBlock: (name: string) => string
  /** Insert a block node into the active canvas (the `@` Condition path; not a badge). */
  insertBlock: (node: Record<string, unknown>) => void
  /** Remove the open `@`-picker chip without inserting a badge. */
  closePicker: () => void
}

const ProcedureEditorContext = createContext<ProcedureEditorContextValue | null>(null)

export function ProcedureEditorProvider({
  value,
  children,
}: {
  value: ProcedureEditorContextValue
  children: ReactNode
}) {
  return <ProcedureEditorContext.Provider value={value}>{children}</ProcedureEditorContext.Provider>
}

/** Read editor-level procedure state from inside a node view (returns null outside an editor). */
export function useProcedureEditorContext(): ProcedureEditorContextValue | null {
  return useContext(ProcedureEditorContext)
}
