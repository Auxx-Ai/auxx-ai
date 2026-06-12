// apps/web/src/components/schema-editor/ui/schema-editor-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { AlertTriangle, Braces, GitBranch } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  draftToJsonSchema,
  jsonSchemaRootKind,
  jsonSchemaToDraft,
  type SchemaFieldDraft,
  type SchemaPolicy,
  type SchemaRootKind,
} from '../schema-draft'
import { parseSchemaText, validateSchema } from '../validation'
import { CodeEditor } from './code-editor'
import { JsonImporter } from './json-importer'
import { SchemaFieldTree } from './schema-field-tree'

/** How the editor was seeded — drives saved provenance (inferred vs manual). */
export type SeededFrom = 'inferred' | 'existing' | 'empty'

/** Whether the saved schema is the unmodified inference or a user edit. */
export type SaveSource = 'inferred' | 'manual'

export interface SchemaEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Dialog title — "Structured Output" for workflow, the tool name for MCP. */
  title: string
  initial: { schema: Record<string, unknown>; seededFrom: SeededFrom }
  policy: SchemaPolicy
  onSave: (schema: Record<string, unknown>, source: SaveSource) => void
}

type Tab = 'visual' | 'json'

/**
 * The shared schema editor — one dialog consumed by MCP tool output schemas
 * (`policy.emitRequired: false`) and workflow nodes (`true`). Rows are the
 * source of truth on the Visual tab; the JSON tab is the persisted document
 * verbatim (including `x-auxx` power-user edits). Cancel = close (edits live
 * only in local draft state until Save), so there is no backup/restore.
 */
export function SchemaEditorDialog({
  open,
  onOpenChange,
  title,
  initial,
  policy,
  onSave,
}: SchemaEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-4xl h-[600px]' position='tc'>
        {/* Remount on each open so the draft re-seeds from `initial`. */}
        {open && (
          <SchemaEditorBody
            title={title}
            initial={initial}
            policy={policy}
            onSave={onSave}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function SchemaEditorBody({
  title,
  initial,
  policy,
  onSave,
  onClose,
}: {
  title: string
  initial: { schema: Record<string, unknown>; seededFrom: SeededFrom }
  policy: SchemaPolicy
  onSave: (schema: Record<string, unknown>, source: SaveSource) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('visual')
  const [rows, setRows] = useState<SchemaFieldDraft[]>(() => jsonSchemaToDraft(initial.schema))
  const [jsonText, setJsonText] = useState(() => JSON.stringify(initial.schema, null, 2))
  const [rootKind, setRootKind] = useState<SchemaRootKind>(() => jsonSchemaRootKind(initial.schema))
  const [error, setError] = useState<string | null>(null)

  const rootPolicy = policy.root ?? 'object'

  // Serialize the current visual-tab state to a JSON Schema document.
  //  - object / array-of-objects roots round-trip through the row model;
  //  - an 'other' root (scalar, array of scalars) can't be represented as rows,
  //    so the JSON-tab document passes through UNCHANGED (never an empty object).
  const serializeVisual = useCallback((): Record<string, unknown> => {
    if (rootKind === 'object' || rootKind === 'array-of-objects') {
      return draftToJsonSchema(rows, policy, rootKind)
    }
    const parsed = parseSchemaText(jsonText)
    return parsed.ok ? parsed.schema : initial.schema
  }, [rootKind, rows, policy, jsonText, initial.schema])

  // Keyboard submit (Enter / ⌘↵) on the dialog — handled here so it works from
  // either tab without a real <form>.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const submit = e.key === 'Enter' && (e.metaKey || e.ctrlKey)
      if (submit) {
        e.preventDefault()
        handleSave()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })

  const handleTabChange = useCallback(
    (value: string) => {
      const next = value as Tab
      if (next === tab) return
      if (next === 'json') {
        setJsonText(JSON.stringify(serializeVisual(), null, 2))
        setError(null)
        setTab('json')
        return
      }
      // json → visual: validate before leaving the JSON tab, then re-derive the
      // root kind (a JSON edit can change object ⇄ array ⇄ scalar root).
      const parsed = parseSchemaText(jsonText)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      const result = validateSchema(parsed.schema, rootPolicy)
      if (!result.ok) {
        setError(result.error ?? 'Invalid schema')
        return
      }
      setRows(jsonSchemaToDraft(parsed.schema))
      setRootKind(jsonSchemaRootKind(parsed.schema))
      setError(null)
      setTab('visual')
    },
    [tab, serializeVisual, jsonText, rootPolicy]
  )

  const handleImport = useCallback(
    (schema: Record<string, unknown>) => {
      setRows(jsonSchemaToDraft(schema))
      setRootKind(jsonSchemaRootKind(schema))
      if (tab === 'json') setJsonText(JSON.stringify(schema, null, 2))
      setError(null)
    },
    [tab]
  )

  const handleSave = useCallback(() => {
    let schema: Record<string, unknown>
    if (tab === 'json') {
      const parsed = parseSchemaText(jsonText)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      const result = validateSchema(parsed.schema, rootPolicy)
      if (!result.ok) {
        setError(result.error ?? 'Invalid schema')
        return
      }
      schema = parsed.schema
    } else {
      schema = serializeVisual()
    }
    const source: SaveSource =
      initial.seededFrom === 'inferred' && deepEqual(schema, initial.schema) ? 'inferred' : 'manual'
    onSave(schema, source)
    onClose()
  }, [tab, jsonText, serializeVisual, rootPolicy, initial, onSave, onClose])

  return (
    <div className='relative flex h-full flex-1 flex-col overflow-hidden'>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>

      <div className='flex items-center justify-between py-2'>
        <RadioTab
          value={tab}
          onValueChange={handleTabChange}
          size='sm'
          radioGroupClassName='grid w-full'
          className='flex border border-primary-200'>
          <RadioTabItem value='visual' size='sm'>
            <GitBranch />
            Visual
          </RadioTabItem>
          <RadioTabItem value='json' size='sm'>
            <Braces />
            JSON
          </RadioTabItem>
        </RadioTab>
        <JsonImporter onImport={handleImport} root={rootPolicy} />
      </div>

      <div className='flex grow flex-col gap-y-1 overflow-hidden'>
        {tab === 'visual' ? (
          rootKind === 'other' ? (
            <NonObjectRootNotice />
          ) : (
            <SchemaFieldTree
              rows={rows}
              onChange={setRows}
              policy={policy}
              rootTypeLabel={rootKind === 'array-of-objects' ? 'array of objects' : 'object'}
            />
          )
        ) : (
          <CodeEditor
            className='grow rounded-xl'
            editorWrapperClassName='grow'
            value={jsonText}
            onUpdate={setJsonText}
          />
        )}
        {error && (
          <div className='flex gap-x-1 rounded-lg border-[0.5px] p-2'>
            <AlertTriangle className='size-4 shrink-0 text-bad-500' />
            <div className='system-xs-medium max-h-12 grow overflow-y-auto break-words'>
              {error}
            </div>
          </div>
        )}
      </div>

      <DialogFooter className='mt-0'>
        <Button variant='ghost' size='sm' onClick={onClose}>
          Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
        </Button>
        <Button variant='outline' size='sm' onClick={handleSave} data-dialog-submit>
          Save <KbdSubmit variant='outline' size='sm' />
        </Button>
      </DialogFooter>
    </div>
  )
}

/**
 * Visual-tab placeholder for a root the row model can't represent (a scalar root,
 * or an array of scalars). The JSON tab edits it directly; saving from the visual
 * tab passes the JSON document through unchanged.
 */
function NonObjectRootNotice() {
  return (
    <div className='flex h-full items-center justify-center rounded-xl bg-primary-100 p-6'>
      <div className='flex max-w-sm items-start gap-x-2 text-center'>
        <Braces className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
        <p className='text-muted-foreground text-sm'>
          This schema's root isn't an object, so it can't be edited as fields. Switch to the JSON
          tab to edit it.
        </p>
      </div>
    </div>
  )
}

/** Order-insensitive structural equality — for inferred-vs-edited provenance. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const ak = Object.keys(ao)
    const bk = Object.keys(bo)
    if (ak.length !== bk.length) return false
    return ak.every((k) => k in bo && deepEqual(ao[k], bo[k]))
  }
  return false
}
